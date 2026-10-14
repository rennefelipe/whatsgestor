import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WhatsappAttachmentSendingService } from './whatsapp-attachment-sending.service';
import { WhatsappConversationsService } from '../whatsapp-conversations/whatsapp-conversations.service';
import { WhatsappSessionManagerService } from './baileys/whatsapp-session-manager.service';
import type { UserResponse } from '../users/users.service';
import { PrivateMediaStorage } from '../whatsapp-conversations/private-media-storage';
import {
  OutboundMediaJournal,
  type OutboundRecord,
} from './outbound-media-journal';
import { attachmentFixture } from '../../test/attachment-fixture';
import * as outboundAudio from './outbound-audio';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('./baileys/whatsapp-session-manager.service', () => ({
  WhatsappSessionManagerService: class {},
}));

describe('durable outbound attachments', () => {
  let root: string;
  let storage: PrivateMediaStorage;
  let journal: OutboundMediaJournal;
  let service: WhatsappAttachmentSendingService;
  let sendAttachment: jest.Mock;
  let persist: jest.Mock;
  let findOne: jest.Mock;
  let connection: jest.Mock;
  const user = {
    id: randomUUID(),
    isActive: true,
    isAdmin: false,
  } as UserResponse;
  const conversation = {
    id: randomUUID(),
    connectionId: randomUUID(),
    remoteJid: 'synthetic@lid',
    attendanceStatus: 'in_progress',
    assignedUserId: user.id,
  };
  const message = { id: randomUUID(), conversationId: conversation.id };
  const oldFeature = process.env.WHATSAPP_MEDIA_ENABLED;
  beforeEach(async () => {
    process.env.WHATSAPP_MEDIA_ENABLED = 'true';
    root = await mkdtemp(join(tmpdir(), 'whatsgestor-outbound-test-'));
    storage = new PrivateMediaStorage(root);
    journal = new OutboundMediaJournal(storage);
    await journal.initialize();
    persist = jest.fn().mockResolvedValue(message);
    findOne = jest.fn().mockResolvedValue(conversation);
    connection = jest.fn().mockResolvedValue(undefined);
    sendAttachment = jest
      .fn()
      .mockImplementation(
        async (_connection, _jid, media: { stream: NodeJS.ReadableStream }) => {
          for await (const chunk of media.stream) {
            void chunk;
          }
          return {
            whatsappMessageId: 'confirmed-id',
            messageTimestamp: new Date(),
          };
        },
      );
    service = new WhatsappAttachmentSendingService(
      {
        findOne,
        persistConfirmedAttachment: persist,
        findMessage: jest.fn().mockResolvedValue(message),
      } as unknown as WhatsappConversationsService,
      {
        sendAttachment,
        assertAttachmentConnection: connection,
      } as unknown as WhatsappSessionManagerService,
    );
    Object.assign(service, { storage, journal, ready: true });
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    await journal.close();
    await rm(root, { recursive: true, force: true });
    if (oldFeature === undefined) delete process.env.WHATSAPP_MEDIA_ENABLED;
    else process.env.WHATSAPP_MEDIA_ENABLED = oldFeature;
    jest.restoreAllMocks();
  });
  it.each(['jpeg', 'png', 'webp', 'pdf'] as const)(
    'sends %s once, confirms metadata and repeats only the same result',
    async (format) => {
      const id = randomUUID(),
        file = await attachmentFixture(format);
      await expect(
        service.send(conversation.id, user, id, file),
      ).resolves.toEqual(message);
      await expect(
        service.send(conversation.id, user, id, file),
      ).resolves.toEqual(message);
      expect(sendAttachment).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(journal.records.get(id)).toMatchObject({
        state: 'registered',
        messageId: message.id,
        whatsappMessageId: 'confirmed-id',
        metadata: { mimeType: file.mimetype },
      });
      expect((await service.status(conversation.id, user, id)).message).toEqual(
        message,
      );
    },
  );
  it('sends normalized audio through the same durable journal and persists its duration', async () => {
    const normalized = Buffer.from('OggS normalized opus');
    jest.spyOn(outboundAudio, 'normalizeRecordedAudio').mockResolvedValue({
      buffer: normalized,
      metadata: {
        kind: 'audio',
        mimeType: 'audio/ogg',
        originalName: 'gravacao.ogg',
        size: normalized.length,
        durationSeconds: 17,
      },
    });
    const id = randomUUID();
    await expect(
      service.sendAudio(conversation.id, user, id, {
        buffer: Buffer.from('browser recording'),
        size: 17,
        originalname: 'gravacao.webm',
        mimetype: 'audio/webm',
      }),
    ).resolves.toEqual(message);
    expect(sendAttachment).toHaveBeenCalledTimes(1);
    expect(sendAttachment).toHaveBeenCalledWith(
      conversation.connectionId,
      conversation.remoteJid,
      expect.objectContaining({
        kind: 'audio',
        mimeType: 'audio/ogg',
        originalName: 'gravacao.ogg',
        durationSeconds: 17,
      }),
    );
    expect(journal.records.get(id)).toMatchObject({
      state: 'registered',
      metadata: { kind: 'audio', durationSeconds: 17 },
    });
  });
  it('retains confirmed file when SQL fails and recovers after restart without sending', async () => {
    const id = randomUUID();
    persist.mockRejectedValueOnce(Error('SQL unavailable'));
    await expect(
      service.send(conversation.id, user, id, await attachmentFixture('png')),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(journal.records.get(id)?.state).toBe('confirmed');
    await service.onModuleDestroy();
    journal = new OutboundMediaJournal(storage);
    Object.assign(service, { journal, ready: false });
    let finishRegistration: (value: typeof message) => void = () => undefined;
    persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRegistration = resolve;
        }),
    );
    await service.onModuleInit();
    // Startup finishes while SQL recovery is still pending; no resend is made.
    while (persist.mock.calls.length < 2)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(journal.records.get(id)?.state).toBe('confirmed');
    finishRegistration(message);
    while (journal.records.get(id)?.state !== 'registered')
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(sendAttachment).toHaveBeenCalledTimes(1);
    expect(journal.records.get(id)?.state).toBe('registered');
  });
  it('keeps uncertain result blocked, does not invent a message and permits a new intent only after manual review', async () => {
    const id = randomUUID(),
      file = await attachmentFixture('pdf');
    sendAttachment.mockRejectedValueOnce(new BadGatewayException());
    await expect(
      service.send(conversation.id, user, id, file),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      service.send(conversation.id, user, id, file),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.send(conversation.id, user, randomUUID(), file),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(persist).not.toHaveBeenCalled();
    expect(sendAttachment).toHaveBeenCalledTimes(1);
    await service.review(conversation.id, user, id);
    await expect(
      service.send(conversation.id, user, id, file),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.send(conversation.id, user, randomUUID(), file),
    ).resolves.toEqual(message);
    expect(sendAttachment).toHaveBeenCalledTimes(2);
  });
  it('rejects disconnected connection and unauthorized attendance before saving a file', async () => {
    const file = await attachmentFixture('png');
    connection.mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(
      service.send(conversation.id, user, randomUUID(), file),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    findOne.mockResolvedValueOnce({
      ...conversation,
      assignedUserId: randomUUID(),
    });
    await expect(
      service.send(conversation.id, user, randomUUID(), file),
    ).rejects.toBeInstanceOf(ForbiddenException);
    findOne.mockResolvedValueOnce({
      ...conversation,
      attendanceStatus: 'finished',
    });
    await expect(
      service.send(conversation.id, user, randomUUID(), file),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sendAttachment).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(
      (await readdir(root)).filter((name) => name.endsWith('.bin')),
    ).toEqual([]);
  });
  it('blocks concurrent attempts while the first confirmation is pending', async () => {
    let complete: (result: {
      whatsappMessageId: string;
      messageTimestamp: Date;
    }) => void = () => undefined;
    sendAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const file = await attachmentFixture('png'),
      id = randomUUID();
    const pending = service.send(conversation.id, user, id, file);
    while (!sendAttachment.mock.calls.length)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      service.send(conversation.id, user, randomUUID(), file),
    ).rejects.toBeInstanceOf(ConflictException);
    complete({
      whatsappMessageId: 'confirmed-id',
      messageTimestamp: new Date(),
    });
    await pending;
    expect(sendAttachment).toHaveBeenCalledTimes(1);
  });
  it('marks interrupted sending uncertain on restart; never calls Baileys for recovery', async () => {
    const id = randomUUID();
    sendAttachment.mockRejectedValueOnce(new BadGatewayException());
    await service
      .send(conversation.id, user, id, await attachmentFixture('png'))
      .catch(() => undefined);
    const record = journal.records.get(id)!;
    await journal.put({ ...record, state: 'sending' });
    await service.onModuleDestroy();
    journal = new OutboundMediaJournal(storage);
    Object.assign(service, { journal, ready: false });
    await service.onModuleInit();
    expect(journal.records.get(id)?.state).toBe('uncertain');
    expect(sendAttachment).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });
  it('cleans prepared files/parts after a preflight change or interrupted upload', async () => {
    connection
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(
      service.send(
        conversation.id,
        user,
        randomUUID(),
        await attachmentFixture('png'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(
      (await readdir(root)).filter((name) => /\.bin(?:\.part)?$/.test(name)),
    ).toEqual([]);
    expect(sendAttachment).not.toHaveBeenCalled();
  });
  it('locks one journal to a single backend process', async () => {
    const other = new OutboundMediaJournal(storage);
    await expect(other.initialize()).rejects.toThrow(/already in use/);
  });
  it('bounds processing even when earlier HTTP clients disconnect before their sends settle', async () => {
    Object.assign(service, { active: new Set([randomUUID(), randomUUID()]) });
    await expect(
      service.preflight(conversation.id, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.send(
        conversation.id,
        user,
        randomUUID(),
        await attachmentFixture('png'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sendAttachment).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });
  it('cleans local failures between recording sending and invoking transport, without leaving an endless pending send', async () => {
    jest
      .spyOn(storage, 'read')
      .mockRejectedValueOnce(Error('Synthetic local read failure'));
    const id = randomUUID();
    await expect(
      service.send(conversation.id, user, id, await attachmentFixture('png')),
    ).rejects.toThrow('Synthetic local read failure');
    expect(journal.records.get(id)?.state).toBe('failed');
    expect(sendAttachment).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(
      (await readdir(root)).filter((name) => /\.bin(?:\.part)?$/.test(name)),
    ).toEqual([]);
  });
  it('treats a crash window after acknowledgement but before durable confirmation as uncertain', async () => {
    const originalPut = async (record: OutboundRecord) => {
      await OutboundMediaJournal.prototype.put.call(journal, record);
    };
    jest.spyOn(journal, 'put').mockImplementation(async (record) => {
      if (record.state === 'confirmed') throw Error('Synthetic disk failure');
      await originalPut(record);
    });
    const id = randomUUID();
    await expect(
      service.send(conversation.id, user, id, await attachmentFixture('png')),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(persist).not.toHaveBeenCalled();
    await service.onModuleDestroy();
    journal = new OutboundMediaJournal(storage);
    Object.assign(service, { journal, ready: false });
    await service.onModuleInit();
    expect(journal.records.get(id)?.state).toBe('uncertain');
    expect(sendAttachment).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });
});
