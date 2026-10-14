const previousMediaFlag = process.env.WHATSAPP_MEDIA_ENABLED;
beforeAll(() => {
  process.env.WHATSAPP_MEDIA_ENABLED = 'true';
});
afterAll(() => {
  if (previousMediaFlag === undefined)
    delete process.env.WHATSAPP_MEDIA_ENABLED;
  else process.env.WHATSAPP_MEDIA_ENABLED = previousMediaFlag;
});
import { Readable } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import type { WAMessage } from '@whiskeysockets/baileys';
import { PrivateMediaStorage } from './private-media-storage';
import { incomingMedia, type IncomingMedia } from './incoming-media';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { WhatsappMessageMedia } from './entities/whatsapp-message-media.entity';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
import { WhatsappMediaService } from './whatsapp-media.service';
import {
  BaileysIncomingMessageProcessor,
  normalizeIncomingMessage,
} from './baileys-incoming-message.processor';
import { WhatsappConversationsService } from './whatsapp-conversations.service';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
function event(
  type: string,
  mimetype: string,
  extra: Record<string, unknown> = {},
): WAMessage {
  return {
    key: { id: 'wa', remoteJid: 'client@lid', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      [type]: {
        mimetype,
        mediaKey: Buffer.alloc(32),
        directPath: '/v/t62/file',
        ...extra,
      },
    },
  };
}
const metadata: IncomingMedia = {
  kind: 'image',
  mimeType: 'image/png',
  originalName: null,
  caption: null,
  durationSeconds: null,
  expectedHash: null,
};
function fixture() {
  let row: WhatsappMessageMedia | null = null;
  const repository = {
    findOneBy: jest.fn(() => Promise.resolve(row)),
    create: (value: Partial<WhatsappMessageMedia>) =>
      Object.assign(new WhatsappMessageMedia(), value),
    save: jest.fn((value: WhatsappMessageMedia) => {
      if (row) return Promise.reject(new Error('duplicate'));
      row = Object.assign(value, { id: 'media' });
      return Promise.resolve(row);
    }),
    update: jest.fn((_id: string, changes: Partial<WhatsappMessageMedia>) => {
      Object.assign(row!, changes);
      return Promise.resolve({ affected: 1 });
    }),
  };
  const service = new WhatsappMediaService(
    repository as unknown as Repository<WhatsappMessageMedia>,
  );
  const message = Object.assign(new WhatsappMessage(), {
    id: 'message',
    messageTimestamp: new Date(),
    fromMe: false,
  });
  return { service, repository, message, row: () => row };
}
describe('Incoming media normalization', () => {
  it('keeps media disabled before migration without touching media persistence', async () => {
    process.env.WHATSAPP_MEDIA_ENABLED = 'false';
    try {
      const persistMessage = jest.fn();
      const receive = jest.fn();
      const processor = new BaileysIncomingMessageProcessor(
        { persistMessage } as unknown as WhatsappConversationsService,
        { receive } as unknown as WhatsappMediaService,
      );
      await processor.process('connection', {
        type: 'notify',
        messages: [event('imageMessage', 'image/png')],
      });
      expect(persistMessage).not.toHaveBeenCalled();
      expect(receive).not.toHaveBeenCalled();
    } finally {
      process.env.WHATSAPP_MEDIA_ENABLED = 'true';
    }
  });
  it.each([
    ['imageMessage', 'image/png', 'image'],
    ['documentMessage', 'application/pdf', 'document'],
    ['audioMessage', 'audio/ogg; codecs=opus', 'audio'],
  ])('recognizes %s and preserves message identity', (type, mime, kind) => {
    const received = event(type, mime);
    expect(
      normalizeIncomingMessage('connection', 'notify', received),
    ).toMatchObject({
      connectionId: 'connection',
      remoteJid: 'client@lid',
      whatsappMessageId: 'wa',
      fromMe: false,
      messageType: kind,
    });
  });
  it('sanitizes filenames without deriving a telephone from lid', () => {
    expect(
      incomingMedia(
        event('documentMessage', 'application/pdf', {
          fileName: '../secret\\file.pdf',
        }),
      )?.originalName,
    ).toBe('.._secret_file.pdf');
  });
  it('rejects unsupported executable documents and non-WhatsApp download URLs', () => {
    expect(
      incomingMedia(event('documentMessage', 'application/x-msdownload')),
    ).toBeNull();
    expect(
      incomingMedia(
        event('imageMessage', 'image/png', { url: 'http://127.0.0.1/private' }),
      ),
    ).toBeNull();
  });
  it.each(['append', 'notify'])(
    'does not fetch media from historical/recovery event %s',
    async (type) => {
      const persistMessage = jest.fn();
      const receive = jest.fn();
      const processor = new BaileysIncomingMessageProcessor(
        { persistMessage } as unknown as WhatsappConversationsService,
        { receive } as unknown as WhatsappMediaService,
      );
      await processor.process('connection', {
        type: type as 'append' | 'notify',
        requestId: 'recovery',
        messages: [event('imageMessage', 'image/png')],
      });
      expect(persistMessage).not.toHaveBeenCalled();
      expect(receive).not.toHaveBeenCalled();
    },
  );
  it.each([true, false])('rejects outgoing/group media (%s)', (outgoing) => {
    const message = event('audioMessage', 'audio/ogg');
    message.key.fromMe = outgoing;
    if (!outgoing) message.key.remoteJid = 'group@g.us';
    expect(
      normalizeIncomingMessage('connection', 'notify', message),
    ).toBeNull();
  });
  it('commits message persistence before media download and continues with text', async () => {
    const calls: string[] = [];
    const persistMessage = jest.fn(() => {
      calls.push('persist');
      return Promise.resolve({ id: 'message' });
    });
    let release: () => void = () => undefined;
    const receive = jest.fn(() => {
      calls.push('download');
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const processor = new BaileysIncomingMessageProcessor(
      { persistMessage } as unknown as WhatsappConversationsService,
      { receive } as unknown as WhatsappMediaService,
    );
    const text: WAMessage = {
      key: { id: 'text', remoteJid: 'client@lid', fromMe: false },
      message: { conversation: 'text' },
    };
    const processing = processor.process('connection', {
      type: 'notify',
      messages: [event('imageMessage', 'image/png'), text],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual(['persist', 'download', 'persist']);
    release();
    await processing;
  });
});
describe('Private media storage', () => {
  let directory: string;
  let storage: PrivateMediaStorage;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'whatsgestor-media-test-'));
    storage = new PrivateMediaStorage(directory);
  });
  afterEach(async () => {
    if (directory.startsWith(join(tmpdir(), 'whatsgestor-media-test-')))
      await rm(directory, { recursive: true, force: true });
  });
  it.each([
    ['image/png', png],
    ['application/pdf', Buffer.from('%PDF-1.7 synthetic')],
    ['audio/ogg', Buffer.from('OggS synthetic')],
  ])(
    'stores and streams %s privately with internal UUID names',
    async (mime, content) => {
      const result = await storage.save(
        Readable.from([content]),
        {
          ...metadata,
          mimeType: mime,
          kind:
            mime === 'application/pdf'
              ? 'document'
              : mime === 'audio/ogg'
                ? 'audio'
                : 'image',
          expectedHash: createHash('sha256').update(content).digest(),
        },
        new AbortController().signal,
      );
      expect(result.key).toMatch(/^[0-9a-f-]{36}\.bin$/);
      expect(result.size).toBe(content.length);
      const file = await storage.read(result.key);
      const chunks: Buffer[] = [];
      for await (const chunk of file.stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks)).toEqual(content);
      expect(await readdir(directory)).toEqual([result.key]);
    },
  );
  it.each(['invalid', 'oversized', 'hash', 'aborted'])(
    'rejects %s without leaving partial files',
    async (reason) => {
      const content =
        reason === 'oversized'
          ? Buffer.alloc(5 * 1024 * 1024 + 1)
          : reason === 'invalid'
            ? Buffer.from('MZ executable')
            : png;
      const controller = new AbortController();
      if (reason === 'aborted') controller.abort();
      await expect(
        storage.save(
          Readable.from([content]),
          {
            ...metadata,
            expectedHash: reason === 'hash' ? Buffer.alloc(32) : null,
          },
          controller.signal,
        ),
      ).rejects.toThrow();
      expect(await readdir(directory)).toEqual([]);
    },
  );
  it('rejects path traversal and storage inside the repository', async () => {
    await expect(storage.read('../secret')).rejects.toThrow(
      'Invalid media key',
    );
    expect(() => new PrivateMediaStorage(join(__dirname, 'private'))).toThrow(
      'outside the project',
    );
  });
});
describe('Media persistence and failures', () => {
  it('marks ready only after saving the file and never redownloads duplicates', async () => {
    const f = fixture();
    const save = jest
      .spyOn(f.service['storage'], 'save')
      .mockResolvedValue({ key: 'key', size: 11 });
    const download = jest.fn().mockResolvedValue(Readable.from([png]));
    await f.service.receive(f.message, metadata, download);
    await f.service.receive(f.message, metadata, download);
    expect(download).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(f.row()).toMatchObject({ availability: 'ready', sizeBytes: 11 });
  });
  it('handles simultaneous duplicates with one metadata row and one download', async () => {
    const f = fixture();
    jest
      .spyOn(f.service['storage'], 'save')
      .mockResolvedValue({ key: 'key', size: 11 });
    const download = jest.fn().mockResolvedValue(Readable.from([png]));
    await Promise.all([
      f.service.receive(f.message, metadata, download),
      f.service.receive(f.message, metadata, download),
    ]);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('keeps the persisted message and records a failed download', async () => {
    const f = fixture();
    const warn = jest
      .spyOn(f.service['logger'], 'warn')
      .mockImplementation(() => undefined);
    const original = { ...f.message };
    await f.service.receive(f.message, metadata, () =>
      Promise.reject(new Error('private URL must not be logged')),
    );
    expect(f.row()).toMatchObject({
      messageId: f.message.id,
      availability: 'failed',
    });
    expect(f.message).toEqual(original);
    expect(warn).toHaveBeenCalledWith('whatsapp_media_download_failed');
  });
  it('does not download messages older than 24 hours', async () => {
    const f = fixture();
    f.message.messageTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const download = jest.fn();
    await f.service.receive(f.message, metadata, download);
    expect(download).not.toHaveBeenCalled();
    expect(f.row()?.availability).toBe('failed');
  });
  it('scopes file lookup to both conversation and message without exposing storage keys', async () => {
    const builder = {
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    const service = new WhatsappMediaService({
      createQueryBuilder: () => builder,
    } as unknown as Repository<WhatsappMessageMedia>);
    await expect(service.file('wrong-conversation', 'message')).rejects.toThrow(
      'Mídia não encontrada',
    );
    expect(builder.where).toHaveBeenCalledWith(
      expect.stringContaining('message.conversationId = :conversationId'),
      { messageId: 'message', conversationId: 'wrong-conversation' },
    );
  });
});
