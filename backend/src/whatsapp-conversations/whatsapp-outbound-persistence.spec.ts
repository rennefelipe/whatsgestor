import { randomUUID } from 'node:crypto';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { WhatsappMessageMedia } from './entities/whatsapp-message-media.entity';
import type { OutboundRecord } from '../whatsapp-connections/outbound-media-journal';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
describe('confirmed attachment SQL persistence', () => {
  function fixture(failMedia = false, kind: 'image' | 'audio' = 'image') {
    const record = {
      version: 1,
      id: randomUUID(),
      userId: randomUUID(),
      conversationId: randomUUID(),
      connectionId: randomUUID(),
      remoteJid: 'synthetic@lid',
      metadata: {
        kind,
        mimeType: kind === 'audio' ? 'audio/ogg' : 'image/png',
        originalName: kind === 'audio' ? 'gravacao.ogg' : 'anexo.png',
        size: 100,
        ...(kind === 'audio' ? { durationSeconds: 23 } : {}),
      },
      digest: 'a'.repeat(64),
      storageKey: randomUUID() + '.bin',
      state: 'confirmed',
      createdAt: new Date().toISOString(),
      whatsappMessageId: 'wa-id',
      timestamp: new Date().toISOString(),
    } as OutboundRecord;
    let storedMessage: Partial<WhatsappMessage> | null = null,
      storedMedia: Partial<WhatsappMessageMedia> | null = null;
    const builder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    const conversations = {
      findOne: jest.fn().mockResolvedValue({
        id: record.conversationId,
        connectionId: record.connectionId,
        remoteJid: record.remoteJid,
      }),
      createQueryBuilder: jest.fn(() => builder),
    };
    const messages = {
      findOneBy: jest.fn(() => Promise.resolve(storedMessage)),
      create: jest.fn((value: Partial<WhatsappMessage>) => value),
      save: jest.fn((value: Partial<WhatsappMessage>) => {
        storedMessage = { ...value, id: randomUUID() };
        return Promise.resolve(storedMessage);
      }),
      findOneOrFail: jest.fn(() =>
        Promise.resolve({
          ...storedMessage,
          media: { kind, availability: 'ready' },
        }),
      ),
    };
    const media = {
      findOneBy: jest.fn(() => Promise.resolve(storedMedia)),
      create: jest.fn((value: Partial<WhatsappMessageMedia>) => value),
      save: jest.fn((value: Partial<WhatsappMessageMedia>) => {
        if (failMedia) return Promise.reject(Error('SQL media failure'));
        storedMedia = value;
        return Promise.resolve(value);
      }),
    };
    const manager = {
      getRepository: jest.fn(
        (
          entity:
            | typeof WhatsappConversation
            | typeof WhatsappMessage
            | typeof WhatsappMessageMedia,
        ) =>
          entity === WhatsappConversation
            ? conversations
            : entity === WhatsappMessage
              ? messages
              : media,
      ),
    };
    const transaction = jest.fn(
      async (callback: (context: typeof manager) => Promise<unknown>) => {
        const beforeMessage = storedMessage,
          beforeMedia = storedMedia;
        try {
          return await callback(manager);
        } catch (error) {
          storedMessage = beforeMessage;
          storedMedia = beforeMedia;
          throw error;
        }
      },
    );
    const service = Object.create(
      WhatsappConversationsService.prototype,
    ) as WhatsappConversationsService;
    Object.defineProperty(service, 'conversations', {
      value: { manager: { transaction } },
    });
    return {
      service,
      record,
      transaction,
      conversations,
      messages,
      media,
      builder,
      stored: () => ({ storedMessage, storedMedia }),
    };
  }
  it('uses one short transaction and the original conversation, deduplicates and updates only activity', async () => {
    const f = fixture();
    await f.service.persistConfirmedAttachment(f.record);
    await f.service.persistConfirmedAttachment(f.record);
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.messages.save).toHaveBeenCalledTimes(1);
    expect(f.media.save).toHaveBeenCalledTimes(1);
    expect(f.conversations.findOne).toHaveBeenCalledWith({
      where: { id: f.record.conversationId },
      lock: { mode: 'pessimistic_write' },
    });
    expect(f.stored().storedMedia).toMatchObject({
      availability: 'ready',
      storageKey: f.record.storageKey,
      sizeBytes: 100,
    });
    const changes = (f.builder.set.mock.calls as unknown[][])[0][0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(changes)).toEqual(['lastMessageAt']);
    expect(typeof changes.lastMessageAt).toBe('function');
    expect(f.stored().storedMessage).toBeTruthy();
    expect(f.stored().storedMedia).toBeTruthy();
  });
  it('rolls back both records on SQL failure and does not update activity or attendance', async () => {
    const f = fixture(true);
    await expect(
      f.service.persistConfirmedAttachment(f.record),
    ).rejects.toThrow('SQL media failure');
    expect(f.stored()).toEqual({ storedMessage: null, storedMedia: null });
    expect(f.builder.execute).not.toHaveBeenCalled();
  });
  it('persists normalized audio kind and duration without a schema change', async () => {
    const f = fixture(false, 'audio');
    await f.service.persistConfirmedAttachment(f.record);
    expect(f.stored().storedMessage).toMatchObject({
      messageType: 'audio',
      textContent: null,
      status: 'sent',
    });
    expect(f.stored().storedMedia).toMatchObject({
      kind: 'audio',
      mimeType: 'audio/ogg',
      originalName: 'gravacao.ogg',
      durationSeconds: 23,
      availability: 'ready',
    });
  });
});
