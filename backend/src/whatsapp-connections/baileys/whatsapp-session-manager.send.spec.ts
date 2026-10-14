import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WhatsappConnection } from '../entities/whatsapp-connection.entity';
import { Readable } from 'node:stream';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  DisconnectReason: {},
  useMultiFileAuthState: jest.fn(),
}));

import { WhatsappSessionManagerService } from './whatsapp-session-manager.service';

describe('WhatsappSessionManagerService.sendText', () => {
  function createManager(
    connection: Partial<WhatsappConnection>,
    session?: { connected: boolean; socket: { sendMessage: jest.Mock } },
  ): WhatsappSessionManagerService {
    const manager = Object.create(
      WhatsappSessionManagerService.prototype,
    ) as WhatsappSessionManagerService;
    Object.defineProperty(manager, 'connections', {
      value: { findOneBy: jest.fn().mockResolvedValue(connection) },
    });
    const sessions = new Map();
    if (session) sessions.set('connection-uuid', session);
    Object.defineProperty(manager, 'sessions', { value: sessions });
    return manager;
  }

  it('rejects an inactive or disconnected connection without creating a socket', async () => {
    const sendMessage = jest.fn();
    const manager = createManager(
      { isActive: true, status: 'disconnected' },
      { connected: false, socket: { sendMessage } },
    );

    await expect(
      manager.sendText(
        'connection-uuid',
        'recipient@s.whatsapp.net',
        'synthetic text',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('uses the existing socket and returns the Baileys message ID and timestamp', async () => {
    const messageTimestamp = { low: 1_728_000_000, high: 0 };
    const sendMessage = jest.fn().mockResolvedValue({
      key: { id: 'baileys-message-id' },
      messageTimestamp,
    });
    const manager = createManager(
      { isActive: true, status: 'connected' },
      { connected: true, socket: { sendMessage } },
    );

    await expect(
      manager.sendText(
        'connection-uuid',
        'recipient@s.whatsapp.net',
        'synthetic text',
      ),
    ).resolves.toEqual({
      whatsappMessageId: 'baileys-message-id',
      messageTimestamp: new Date(1_728_000_000_000),
    });
    expect(sendMessage).toHaveBeenCalledWith('recipient@s.whatsapp.net', {
      text: 'synthetic text',
    });
  });

  it('does not report success when Baileys rejects the send', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error('synthetic'));
    const manager = createManager(
      { isActive: true, status: 'connected' },
      { connected: true, socket: { sendMessage } },
    );

    await expect(
      manager.sendText(
        'connection-uuid',
        'recipient@s.whatsapp.net',
        'synthetic text',
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
  it.each(['image', 'document'] as const)(
    'sends private %s stream through the existing socket and preserves acknowledgement',
    async (kind) => {
      const sendMessage = jest.fn().mockResolvedValue({
        key: { id: 'attachment-id' },
        messageTimestamp: 1_728_000_000,
      });
      const manager = createManager(
        { isActive: true, status: 'connected' },
        { connected: true, socket: { sendMessage } },
      );
      const stream = Readable.from(Buffer.from('synthetic'));
      await expect(
        manager.sendAttachment('connection-uuid', 'synthetic@lid', {
          kind,
          stream,
          mimeType: kind === 'image' ? 'image/png' : 'application/pdf',
          originalName: 'anexo.pdf',
        }),
      ).resolves.toMatchObject({ whatsappMessageId: 'attachment-id' });
      expect(sendMessage).toHaveBeenCalledWith(
        'synthetic@lid',
        kind === 'image'
          ? { image: { stream }, mimetype: 'image/png' }
          : {
              document: { stream },
              mimetype: 'application/pdf',
              fileName: 'anexo.pdf',
            },
      );
    },
  );
  it('sends normalized Ogg/Opus as a WhatsApp voice note with server-derived duration', async () => {
    const sendMessage = jest.fn().mockResolvedValue({
      key: { id: 'audio-id' },
      messageTimestamp: 1_728_000_000,
    });
    const manager = createManager(
      { isActive: true, status: 'connected' },
      { connected: true, socket: { sendMessage } },
    );
    const stream = Readable.from(Buffer.from('OggS synthetic'));
    await expect(
      manager.sendAttachment('connection-uuid', 'synthetic@lid', {
        kind: 'audio',
        stream,
        mimeType: 'audio/ogg',
        originalName: 'gravacao.ogg',
        durationSeconds: 19,
      }),
    ).resolves.toMatchObject({ whatsappMessageId: 'audio-id' });
    expect(sendMessage).toHaveBeenCalledWith('synthetic@lid', {
      audio: { stream },
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      seconds: 19,
    });
  });
  it('does not send attachments while disconnected or accept a missing acknowledgement', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ key: {} });
    const disconnected = createManager(
      { isActive: true, status: 'disconnected' },
      { connected: false, socket: { sendMessage } },
    );
    const media = {
      kind: 'image' as const,
      stream: Readable.from(Buffer.from('synthetic')),
      mimeType: 'image/png',
      originalName: 'anexo.png',
    };
    await expect(
      disconnected.sendAttachment('connection-uuid', 'synthetic@lid', media),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sendMessage).not.toHaveBeenCalled();
    const connected = createManager(
      { isActive: true, status: 'connected' },
      { connected: true, socket: { sendMessage } },
    );
    await expect(
      connected.sendAttachment('connection-uuid', 'synthetic@lid', media),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
