import { EntityManager, FindOneOptions, Repository, DataSource } from 'typeorm';
import { Contact } from '../contacts/entities/contact.entity';
import { User } from '../users/entities/user.entity';
import { WhatsappConnection } from '../whatsapp-connections/entities/whatsapp-connection.entity';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import {
  WhatsappConversationsService,
  PersistWhatsappMessageInput,
} from './whatsapp-conversations.service';
import { WhatsappAttendanceService } from './whatsapp-attendance.service';

const end = new Date('2026-10-09T12:00:00Z');
const fresh = new Date('2026-10-09T12:00:02Z');
const live = { allowAutomaticReopen: true };

function fixture(
  status: WhatsappConversation['attendanceStatus'] = 'finished',
) {
  const row = Object.assign(new WhatsappConversation(), {
    id: 'conversation',
    connectionId: 'connection',
    remoteJid: 'client@lid',
    contactId: 'contact',
    contact: { id: 'contact', contactName: 'Contato cadastrado' },
    contactName: 'Cliente',
    attendanceStatus: status,
    assignedUserId: status === 'waiting' ? null : 'owner',
    attendanceStartedAt: new Date('2026-10-09T11:00:00Z'),
    attendanceFinishedAt: status === 'finished' ? end : null,
    lastMessageAt: end,
  });
  const history: WhatsappMessage[] = [
    Object.assign(new WhatsappMessage(), {
      id: 'old',
      conversationId: row.id,
      whatsappMessageId: 'old',
      fromMe: false,
      messageTimestamp: new Date('2026-10-09T11:50:00Z'),
      textContent: 'Mensagem anterior',
    }),
  ];
  const input: PersistWhatsappMessageInput = {
    connectionId: row.connectionId,
    remoteJid: row.remoteJid,
    whatsappMessageId: 'new',
    fromMe: false,
    textContent: 'Nova mensagem',
    messageTimestamp: fresh,
  };
  const writes: Array<Record<string, unknown>> = [];
  let clock = new Date('2026-10-09T12:00:01Z');
  let lockTail = Promise.resolve();
  let exists = true;
  let saveError: Error | undefined;
  let failMetadata = false;
  let pause: { entered: () => void; wait: Promise<void> } | undefined;

  const findMessage = (key: Partial<WhatsappMessage>) =>
    Promise.resolve(
      history.find(
        (message) =>
          message.conversationId === key.conversationId &&
          message.whatsappMessageId === key.whatsappMessageId &&
          message.fromMe === key.fromMe,
      ) ?? null,
    );
  const messageRepository = {
    findOneBy: jest.fn(findMessage),
    create: (values: Partial<WhatsappMessage>) =>
      Object.assign(new WhatsappMessage(), values),
    save: jest.fn((message: WhatsappMessage) => {
      if (saveError) return Promise.reject(saveError);
      const saved = Object.assign(message, { id: 'saved-' + history.length });
      history.push(saved);
      return Promise.resolve(saved);
    }),
  };
  function builder() {
    let changes: Record<string, unknown> = {};
    const parameters: Record<string, unknown> = {};
    const query = {
      update: () => query,
      set: (values: Record<string, unknown>) => {
        changes = values;
        return query;
      },
      where: () => query,
      setParameter: (key: string, value: unknown) => {
        parameters[key] = value;
        return query;
      },
      execute: () => {
        if (failMetadata) return Promise.reject(new Error('metadata failure'));
        writes.push(changes);
        if ('contactName' in changes)
          row.contactName = changes.contactName as string;
        const stamp = parameters.messageTimestamp as Date | undefined;
        if (stamp && (!row.lastMessageAt || row.lastMessageAt < stamp))
          row.lastMessageAt = stamp;
        return Promise.resolve({ affected: 1 });
      },
      leftJoin: () => query,
      addSelect: () => query,
      getOne: () => Promise.resolve({ ...row }),
    };
    return query;
  }
  const transaction = jest.fn(
    async (work: (manager: EntityManager) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      let snapshot: WhatsappConversation | undefined;
      let oldHistory: WhatsappMessage[] = [];
      const repository = {
        findOne: async (options: FindOneOptions<WhatsappConversation>) => {
          expect(options.lock).toEqual({ mode: 'pessimistic_write' });
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          snapshot = { ...row };
          oldHistory = [...history];
          const paused = pause;
          pause = undefined;
          if (paused) {
            paused.entered();
            await paused.wait;
          }
          return { ...row };
        },
        createQueryBuilder: builder,
        update: (_id: string, changes: Record<string, unknown>) => {
          writes.push(changes);
          for (const [key, value] of Object.entries(changes)) {
            Object.assign(row, {
              [key]: typeof value === 'function' ? clock : value,
            });
          }
          return Promise.resolve({ affected: 1 });
        },
      };
      const manager = {
        getRepository: (entity: unknown) =>
          entity === WhatsappMessage
            ? messageRepository
            : entity === User
              ? {
                  findOne: () =>
                    Promise.resolve({
                      id: 'owner',
                      isActive: true,
                      isAdmin: false,
                    }),
                }
              : repository,
      } as unknown as EntityManager;
      try {
        return await work(manager);
      } catch (error) {
        if (snapshot) {
          Object.assign(row, snapshot);
          history.splice(0, history.length, ...oldHistory);
        }
        throw error;
      } finally {
        release?.();
      }
    },
  );
  const conversations = {
    manager: { transaction },
    findOneBy: jest.fn(() => Promise.resolve(exists ? row : null)),
    create: (values: Partial<WhatsappConversation>) =>
      Object.assign(new WhatsappConversation(), values),
    save: jest.fn((value: WhatsappConversation) => {
      Object.assign(row, value);
      exists = true;
      return Promise.resolve(row);
    }),
    createQueryBuilder: builder,
  } as unknown as Repository<WhatsappConversation>;
  const service = new WhatsappConversationsService(
    {
      findOneBy: () => Promise.resolve({ id: 'connection' }),
    } as unknown as Repository<WhatsappConnection>,
    conversations,
    messageRepository as unknown as Repository<WhatsappMessage>,
    {} as Repository<Contact>,
  );
  const attendance = new WhatsappAttendanceService({
    transaction,
  } as unknown as DataSource);
  return {
    row,
    input,
    history,
    writes,
    service,
    attendance,
    transaction,
    messageRepository,
    newConversation: () => {
      exists = false;
    },
    failSave: (error: Error) => {
      saveError = error;
    },
    failMetadata: () => {
      failMetadata = true;
    },
    clock: (date: Date) => {
      clock = date;
    },
    pauseNextLock: () => {
      let signalEntered: () => void = () => undefined;
      let releasePause: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => {
        signalEntered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        releasePause = resolve;
      });
      pause = { entered: signalEntered, wait };
      return { entered, release: () => releasePause() };
    },
  };
}

describe('Automatic attendance reopening on live incoming messages', () => {
  it.each(['image', 'document', 'audio'])(
    'preserves waiting and in_progress state and assignee for %s',
    async (messageType) => {
      for (const state of ['waiting', 'in_progress'] as const) {
        const f = fixture(state);
        const owner = f.row.assignedUserId;
        await f.service.persistMessage(
          { ...f.input, messageType, textContent: null },
          live,
        );
        expect(f.row.attendanceStatus).toBe(state);
        expect(f.row.assignedUserId).toBe(owner);
        expect(f.row.contactId).toBe('contact');
        expect(f.history).toHaveLength(2);
      }
    },
  );
  it.each(['image', 'document', 'audio'])(
    'reopens for a new %s while preserving contact, history and historical timestamps',
    async (messageType) => {
      const f = fixture();
      const oldHistory = [...f.history];
      const started = f.row.attendanceStartedAt;
      await f.service.persistMessage(
        { ...f.input, messageType, textContent: null },
        live,
      );
      expect(f.row).toMatchObject({
        attendanceStatus: 'waiting',
        assignedUserId: null,
        contactId: 'contact',
        connectionId: 'connection',
        remoteJid: 'client@lid',
        attendanceStartedAt: started,
        attendanceFinishedAt: end,
      });
      expect(f.history.slice(0, oldHistory.length)).toEqual(oldHistory);
      expect(f.history.at(-1)).toMatchObject({
        messageType,
        textContent: null,
      });
      await f.service.persistMessage(
        { ...f.input, messageType, textContent: null },
        live,
      );
      expect(f.history).toHaveLength(oldHistory.length + 1);
    },
  );
  it('creates a new conversation waiting without an assignee', async () => {
    const f = fixture();
    f.newConversation();
    await f.service.persistMessage(f.input, live);
    expect(f.row).toMatchObject({
      attendanceStatus: 'waiting',
      assignedUserId: null,
    });
  });
  it.each(['waiting', 'in_progress'] as const)(
    'preserves %s and its assignee',
    async (status) => {
      const f = fixture(status);
      const assignee = f.row.assignedUserId;
      await f.service.persistMessage(f.input, live);
      expect(f.row.attendanceStatus).toBe(status);
      expect(f.row.assignedUserId).toBe(assignee);
      expect(f.history).toHaveLength(2);
      expect(f.history[0].textContent).toBe('Mensagem anterior');
    },
  );
  it('reopens finished, releases the assignee and preserves contact, history and timestamps', async () => {
    const f = fixture();
    const original = {
      contactId: f.row.contactId,
      contact: f.row.contact,
      remoteJid: f.row.remoteJid,
      connectionId: f.row.connectionId,
      attendanceStartedAt: f.row.attendanceStartedAt,
      attendanceFinishedAt: f.row.attendanceFinishedAt,
    };
    await f.service.persistMessage(f.input, live);
    expect(f.row).toMatchObject({
      ...original,
      lastMessageAt: fresh,
      attendanceStatus: 'waiting',
      assignedUserId: null,
    });
    expect(f.history).toHaveLength(2);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });
  it('never reopens for outgoing messages, even if the caller enables automatic reopening', async () => {
    const f = fixture();
    await f.service.persistMessage({ ...f.input, fromMe: true }, live);
    expect(f.row.attendanceStatus).toBe('finished');
    expect(f.row.assignedUserId).toBe('owner');
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it.each(['text', 'image', 'document', 'audio'])(
    'does not reopen replayed %s after another finalization',
    async (messageType) => {
      const f = fixture();
      const first = await f.service.persistMessage(
        { ...f.input, messageType },
        live,
      );
      f.row.attendanceStatus = 'finished';
      f.row.assignedUserId = 'owner';
      f.row.attendanceFinishedAt = end;
      await expect(
        f.service.persistMessage({ ...f.input, messageType }, live),
      ).resolves.toBe(first);
      expect(f.row.attendanceStatus).toBe('finished');
      expect(f.history).toHaveLength(2);
      expect(f.messageRepository.save).toHaveBeenCalledTimes(1);
    },
  );
  it('deduplicates simultaneous live deliveries of the same message', async () => {
    const f = fixture();
    const results = await Promise.all([
      f.service.persistMessage(f.input, live),
      f.service.persistMessage(f.input, live),
    ]);
    expect(results[0]).toBe(results[1]);
    expect(f.history).toHaveLength(2);
    expect(f.row.attendanceStatus).toBe('waiting');
  });
  it.each([
    ['older', new Date('2026-10-09T11:59:59Z')],
    ['equal to finish', end],
    ['missing', null],
    ['invalid', new Date('invalid')],
  ])('does not reopen for a %s timestamp', async (_label, timestamp) => {
    const f = fixture();
    await f.service.persistMessage(
      { ...f.input, messageTimestamp: timestamp },
      live,
    );
    expect(f.row.attendanceStatus).toBe('finished');
    expect(f.row.assignedUserId).toBe('owner');
  });
  it('does not reopen when the finish timestamp is missing', async () => {
    const f = fixture();
    f.row.attendanceFinishedAt = null;
    await f.service.persistMessage(f.input, live);
    expect(f.row.attendanceStatus).toBe('finished');
  });
  it('does not reopen recovered or historical messages without live eligibility', async () => {
    const f = fixture();
    await f.service.persistMessage(f.input, { allowAutomaticReopen: false });
    expect(f.row.attendanceStatus).toBe('finished');
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it.each([
    'group@g.us',
    'status@broadcast',
    'list@broadcast',
    'feed@newsletter',
  ])('does not reopen non-individual JID %s', async (remoteJid) => {
    const f = fixture();
    await f.service.persistMessage({ ...f.input, remoteJid }, live);
    expect(f.row.attendanceStatus).toBe('finished');
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('does not reopen if saving the message fails', async () => {
    const f = fixture();
    f.failSave(new Error('insert failure'));
    await expect(f.service.persistMessage(f.input, live)).rejects.toThrow(
      'insert failure',
    );
    expect(f.row.attendanceStatus).toBe('finished');
    expect(f.history).toHaveLength(1);
  });
  it('rolls back message insertion when the metadata operation fails', async () => {
    const f = fixture();
    f.failMetadata();
    await expect(f.service.persistMessage(f.input, live)).rejects.toThrow(
      'metadata failure',
    );
    expect(f.history).toHaveLength(1);
    expect(f.row.attendanceStatus).toBe('finished');
    expect(f.row.lastMessageAt).toBe(end);
  });
  it('recovers a unique-key collision after rollback without reopening', async () => {
    const f = fixture();
    f.failSave(
      Object.assign(new Error('duplicate insert'), {
        driverError: { number: 2627 },
      }),
    );
    const persisted = Object.assign(new WhatsappMessage(), {
      ...f.input,
      id: 'winner',
      conversationId: 'conversation',
    });
    // The winner committed independently, so it becomes visible only after rollback.
    f.messageRepository.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persisted);
    await expect(f.service.persistMessage(f.input, live)).resolves.toBe(
      persisted,
    );
    expect(f.row.attendanceStatus).toBe('finished');
  });
  it.each(['text', 'image', 'document', 'audio'])(
    'waits for a manual finish, then reopens only for a later %s message',
    async (messageType) => {
      const f = fixture('in_progress');
      const paused = f.pauseNextLock();
      const finishing = f.attendance.finish('conversation', 'owner');
      await paused.entered;
      const receiving = f.service.persistMessage(
        { ...f.input, messageType },
        live,
      );
      paused.release();
      await Promise.all([finishing, receiving]);
      expect(f.row.attendanceStatus).toBe('waiting');
      expect(f.row.assignedUserId).toBeNull();
      expect(f.row.attendanceFinishedAt).toEqual(
        new Date('2026-10-09T12:00:01Z'),
      );
    },
  );
  it.each(['text', 'image', 'document', 'audio'])(
    'preserves later manual finish when %s received the lock first',
    async (messageType) => {
      const f = fixture('in_progress');
      f.clock(new Date('2026-10-09T12:00:03Z'));
      const paused = f.pauseNextLock();
      const receiving = f.service.persistMessage(
        { ...f.input, messageType },
        live,
      );
      await paused.entered;
      const finishing = f.attendance.finish('conversation', 'owner');
      paused.release();
      await Promise.all([receiving, finishing]);
      expect(f.row.attendanceStatus).toBe('finished');
      expect(f.row.assignedUserId).toBe('owner');
      expect(f.history).toHaveLength(2);
    },
  );
});
