import { Logger } from '@nestjs/common';
import { WhatsappConnection } from '../entities/whatsapp-connection.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  DisconnectReason: {
    loggedOut: 401,
    badSession: 500,
    forbidden: 403,
    connectionReplaced: 440,
    connectionLost: 408,
  },
  useMultiFileAuthState: jest.fn(),
}));
jest.mock('node:fs/promises', () => ({ rm: jest.fn() }));
import { rm } from 'node:fs/promises';
import { WhatsappSessionManagerService } from './whatsapp-session-manager.service';

describe('session preservation on close', () => {
  function fixture() {
    const manager = Object.create(
      WhatsappSessionManagerService.prototype,
    ) as WhatsappSessionManagerService;
    Object.defineProperty(manager, 'logger', {
      value: new Logger('close-test'),
    });
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    Object.defineProperty(manager, 'connections', { value: { update } });
    jest.spyOn(manager['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(manager['logger'], 'warn').mockImplementation(() => undefined);
    const socket = {} as Parameters<
      (typeof manager)['handleConnectionUpdate']
    >[2];
    const session = {
      socket,
      connected: true,
      stopRequested: false,
      retryAttempts: 0,
      qrGeneration: 0,
    };
    return { manager, update, socket, session };
  }
  beforeEach(() => jest.clearAllMocks());
  it.each([401, 403, 500, 440])(
    'preserves credentials and phone metadata on terminal close %s',
    async (code) => {
      const { manager, update, socket, session } = fixture();
      const retry = jest.spyOn(
        manager as unknown as {
          scheduleReconnect: (...args: unknown[]) => Promise<void>;
        },
        'scheduleReconnect',
      );
      await manager['handleConnectionUpdate']('connection', session, socket, {
        connection: 'close',
        lastDisconnect: {
          date: new Date(),
          error: Object.assign(new Error('Connection Failure'), {
            output: { statusCode: code },
          }),
        },
      });
      expect(rm).not.toHaveBeenCalled();
      expect(retry).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        'connection',
        expect.objectContaining({ status: 'error' }),
      );
      expect(
        update.mock.calls.some(
          (call: [string, Partial<WhatsappConnection>]) =>
            'phoneNumber' in call[1],
        ),
      ).toBe(false);
    },
  );
  it('retries ambiguous WebSocket 500 without treating it as bad credentials', async () => {
    const { manager, update, socket, session } = fixture();
    const retry = jest
      .spyOn(
        manager as unknown as {
          scheduleReconnect: (...args: unknown[]) => Promise<void>;
        },
        'scheduleReconnect',
      )
      .mockImplementation(() => Promise.resolve());
    await manager['handleConnectionUpdate']('connection', session, socket, {
      connection: 'close',
      lastDisconnect: {
        date: new Date(),
        error: Object.assign(
          new Error('WebSocket Error (synthetic transport failure)'),
          { output: { statusCode: 500 } },
        ),
      },
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(rm).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalledWith('connection', { status: 'error' });
  });
});
