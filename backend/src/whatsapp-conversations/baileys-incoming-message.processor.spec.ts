import type { WAMessage } from '@whiskeysockets/baileys';
import { WhatsappConversationsService } from './whatsapp-conversations.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import {
  BaileysIncomingMessageProcessor,
  normalizeIncomingMessage,
} from './baileys-incoming-message.processor';

function message(overrides: Record<string, unknown> = {}): WAMessage {
  return {
    key: {
      remoteJid: '12345@s.whatsapp.net',
      id: 'message-id',
      fromMe: false,
    },
    message: { conversation: 'hello' },
    messageTimestamp: 1_728_000_000,
    pushName: 'Synthetic contact',
    ...overrides,
  };
}

describe('BaileysIncomingMessageProcessor', () => {
  it('normalizes a received plain text message and preserves its connection and timestamp', () => {
    const received = message();

    expect(
      normalizeIncomingMessage('connection-a', 'notify', received),
    ).toEqual({
      connectionId: 'connection-a',
      remoteJid: '12345@s.whatsapp.net',
      contactName: 'Synthetic contact',
      whatsappMessageId: 'message-id',
      fromMe: false,
      messageType: 'text',
      textContent: 'hello',
      messageTimestamp: new Date(1_728_000_000_000),
      status: 'received',
    });
  });

  it('normalizes extended text messages', () => {
    const received = message({
      message: { extendedTextMessage: { text: 'extended hello' } },
    });

    expect(
      normalizeIncomingMessage('connection-a', 'notify', received)?.textContent,
    ).toBe('extended hello');
  });

  it('converts Baileys Long timestamps', () => {
    const received = message({
      messageTimestamp: { low: 1_728_000_000, high: 0, unsigned: false },
    });

    expect(
      normalizeIncomingMessage('connection-a', 'notify', received)
        ?.messageTimestamp,
    ).toEqual(new Date(1_728_000_000_000));
  });

  it.each([
    [
      'message from self',
      message({
        key: { remoteJid: '12345@s.whatsapp.net', id: 'id', fromMe: true },
      }),
    ],
    [
      'group message',
      message({ key: { remoteJid: '12345@g.us', id: 'id', fromMe: false } }),
    ],
    [
      'status broadcast',
      message({
        key: { remoteJid: 'status@broadcast', id: 'id', fromMe: false },
      }),
    ],
    [
      'other broadcast',
      message({
        key: { remoteJid: '12345@broadcast', id: 'id', fromMe: false },
      }),
    ],
    [
      'newsletter',
      message({
        key: { remoteJid: '12345@newsletter', id: 'id', fromMe: false },
      }),
    ],
    ['message without text', message({ message: { imageMessage: {} } })],
    ['message with empty text', message({ message: { conversation: '' } })],
    [
      'message without remote JID',
      message({ key: { id: 'id', fromMe: false } }),
    ],
    [
      'message without ID',
      message({ key: { remoteJid: '12345@s.whatsapp.net', fromMe: false } }),
    ],
    [
      'message with missing fromMe flag',
      message({ key: { remoteJid: '12345@s.whatsapp.net', id: 'id' } }),
    ],
  ])('ignores %s', (_description, received) => {
    expect(
      normalizeIncomingMessage('connection-a', 'notify', received),
    ).toBeNull();
  });

  it('ignores append/history upserts', async () => {
    const persistMessage = jest.fn();
    const processor = new BaileysIncomingMessageProcessor({
      persistMessage,
    } as unknown as WhatsappConversationsService);

    await processor.process('connection-a', {
      type: 'append',
      messages: [message()],
    });

    expect(persistMessage).not.toHaveBeenCalled();
  });

  it('persists messages with the UUID of the socket that emitted the event', async () => {
    const persistMessage = jest.fn().mockResolvedValue({});
    const processor = new BaileysIncomingMessageProcessor({
      persistMessage,
    } as unknown as WhatsappConversationsService);

    await processor.process('connection-a', {
      type: 'notify',
      messages: [message()],
    });
    await processor.process('connection-b', {
      type: 'notify',
      messages: [message()],
    });

    expect(persistMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ connectionId: 'connection-a' }),
      { allowAutomaticReopen: true },
    );
    expect(persistMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ connectionId: 'connection-b' }),
      { allowAutomaticReopen: true },
    );
  });

  it('persists phone recovery notifications without allowing automatic reopen', async () => {
    const persistMessage = jest.fn().mockResolvedValue({});
    const processor = new BaileysIncomingMessageProcessor({
      persistMessage,
    } as unknown as WhatsappConversationsService);
    await processor.process('connection-a', {
      type: 'notify',
      requestId: 'recovery-request',
      messages: [message()],
    });
    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({ fromMe: false }),
      { allowAutomaticReopen: false },
    );
  });

  it('continues processing after a persistence failure without throwing', async () => {
    const persistMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('synthetic persistence error'))
      .mockResolvedValueOnce({});
    const processor = new BaileysIncomingMessageProcessor({
      persistMessage,
    } as unknown as WhatsappConversationsService);
    const logError = jest
      .spyOn(processor['logger'], 'error')
      .mockImplementation(() => undefined);

    await expect(
      processor.process('connection-a', {
        type: 'notify',
        messages: [
          message(),
          message({ key: { ...message().key, id: 'second' } }),
        ],
      }),
    ).resolves.toBeUndefined();

    expect(persistMessage).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      'whatsapp_message_persistence_failed',
    );
  });
});
