import type { WAMessage } from '@whiskeysockets/baileys';
import {
  receivedJidCategory,
  receivedMessageCategory,
  receiveFailureCategory,
  receiveDiagnostic,
} from './receive-diagnostics';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';

jest.mock('node:fs', () => ({
  appendFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  statSync: jest.fn(() => ({ size: 0 })),
}));

describe('safe receive diagnostics', () => {
  const previous = process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL;
  afterEach(() => {
    if (previous === undefined)
      delete process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL;
    else process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL = previous;
    jest.clearAllMocks();
  });
  it.each([undefined, 'invalid', '2000-01-01T00:00:00Z'])(
    'does not write when disabled or expired (%s)',
    (value) => {
      if (value === undefined)
        delete process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL;
      else process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL = value;
      receiveDiagnostic('messages_upsert');
      expect(appendFileSync).not.toHaveBeenCalled();
    },
  );
  it('records categories without message content, JID, keys or names', () => {
    process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL = new Date(
      Date.now() + 60_000,
    ).toISOString();
    const message = {
      key: { remoteJid: '5511999999999@s.whatsapp.net', id: 'private-id' },
      pushName: 'Private name',
      message: {
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              caption: 'Private content',
              mediaKey: Buffer.from('private-key'),
              fileName: 'Private file.pdf',
            },
          },
        },
      },
    } as WAMessage;
    receiveDiagnostic('message_ignored', {
      jidCategory: receivedJidCategory(message.key.remoteJid),
      category: receivedMessageCategory(message),
    });
    const output = jest.mocked(appendFileSync).mock.calls[0][1] as string;
    expect(output).toContain('individual_pn');
    expect(output).toContain('document');
    for (const secret of [
      '5511999999999',
      'private-id',
      'Private name',
      'Private content',
      'private-key',
      'Private file.pdf',
    ])
      expect(output).not.toContain(secret);
  });
  it('does not propagate storage failures into message reception', () => {
    process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL = new Date(
      Date.now() + 60_000,
    ).toISOString();
    jest.mocked(mkdirSync).mockImplementationOnce(() => {
      throw new Error('private filesystem error');
    });
    expect(() => receiveDiagnostic('message_persisted')).not.toThrow();
  });
  it('stops writing at the size limit', () => {
    process.env.WHATSAPP_RECEIVE_DIAGNOSTICS_UNTIL = new Date(
      Date.now() + 60_000,
    ).toISOString();
    jest
      .mocked(statSync)
      .mockReturnValueOnce({ size: 2 * 1024 * 1024 } as ReturnType<
        typeof statSync
      >);
    receiveDiagnostic('messages_upsert');
    expect(appendFileSync).not.toHaveBeenCalled();
  });
  it('classifies errors without serializing their messages', () => {
    expect(
      receiveFailureCategory(new Error('WebSocket Error (private host)')),
    ).toBe('websocket');
    expect(receiveFailureCategory(new Error('Connection Failure'))).toBe(
      'server_rejection',
    );
    expect(receiveFailureCategory(new Error('private SQL details'))).toBe(
      'other',
    );
  });
});
