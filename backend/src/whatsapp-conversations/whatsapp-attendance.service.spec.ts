import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager, FindOneOptions } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { WhatsappConversation } from './entities/whatsapp-conversation.entity';
import { WhatsappAttendanceService } from './whatsapp-attendance.service';

function fixture() {
  const users = new Map([
    ['owner', { id: 'owner', isActive: true, isAdmin: false }],
    ['other', { id: 'other', isActive: true, isAdmin: false }],
    ['admin', { id: 'admin', isActive: true, isAdmin: true }],
    ['inactive', { id: 'inactive', isActive: false, isAdmin: false }],
  ]);
  const row = Object.assign(new WhatsappConversation(), {
    id: 'conversation',
    contactId: 'contact',
    contact: { id: 'contact', contactName: 'Contato' },
    remoteJid: 'original@lid',
    connectionId: 'connection',
  });
  const writes: Array<Record<string, unknown>> = [];
  let rowAvailable = Promise.resolve();
  let exists = true;
  const transaction = jest.fn(
    async (work: (manager: EntityManager) => Promise<WhatsappConversation>) => {
      let release: (() => void) | undefined;
      const builder = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(() => Promise.resolve({ ...row })),
      };
      const repository = {
        findOne: jest.fn(
          async (options: FindOneOptions<WhatsappConversation>) => {
            expect(options.lock).toEqual({ mode: 'pessimistic_write' });
            const previous = rowAvailable;
            rowAvailable = new Promise<void>((resolve) => {
              release = resolve;
            });
            await previous;
            return exists ? { ...row } : null;
          },
        ),
        update: jest.fn((_id: string, changes: Record<string, unknown>) => {
          writes.push(changes);
          for (const [key, value] of Object.entries(changes)) {
            Object.assign(row, {
              [key]:
                typeof value === 'function'
                  ? new Date('2026-10-09T12:00:00Z')
                  : value,
            });
          }
          return Promise.resolve({ affected: 1 });
        }),
        createQueryBuilder: () => builder,
      };
      const manager = {
        getRepository: (entity: unknown) =>
          entity === User
            ? {
                findOne: (options: FindOneOptions<User>) => {
                  expect(options.lock).toEqual({ mode: 'pessimistic_read' });
                  const where = options.where as {
                    id: string;
                    isActive: boolean;
                  };
                  expect(where.isActive).toBe(true);
                  const user = users.get(where.id);
                  return Promise.resolve(user?.isActive ? user : null);
                },
              }
            : repository,
      } as unknown as EntityManager;
      try {
        return await work(manager);
      } finally {
        release?.();
      }
    },
  );
  const service = new WhatsappAttendanceService({
    transaction,
  } as unknown as DataSource);
  return {
    service,
    row,
    writes,
    transaction,
    remove: () => {
      exists = false;
    },
  };
}

describe('WhatsappAttendanceService', () => {
  it('starts new conversations waiting with no owner or timestamps', () => {
    expect(new WhatsappConversation()).toMatchObject({
      attendanceStatus: 'waiting',
      assignedUserId: null,
      attendanceStartedAt: null,
      attendanceFinishedAt: null,
    });
  });
  it('claims a waiting conversation and uses SQL Server UTC time', async () => {
    const { service, writes, transaction } = fixture();
    await expect(service.claim('conversation', 'owner')).resolves.toMatchObject(
      {
        attendanceStatus: 'in_progress',
        assignedUserId: 'owner',
        attendanceStartedAt: expect.any(Date) as unknown,
        attendanceFinishedAt: null,
      },
    );
    expect((writes[0].attendanceStartedAt as () => string)()).toBe(
      'SYSUTCDATETIME()',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('allows one winner for concurrent claims and returns 409 to the loser', async () => {
    const { service, writes, row } = fixture();
    const results = await Promise.allSettled([
      service.claim('conversation', 'owner'),
      service.claim('conversation', 'other'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictException);
    expect((failed.reason as ConflictException).getStatus()).toBe(409);
    expect(row.assignedUserId).toBe('owner');
    expect(writes).toHaveLength(1);
  });
  it.each(['owner', 'other', 'admin'])(
    'rejects a claim on an occupied conversation from %s',
    async (actor) => {
      const { service } = fixture();
      await service.claim('conversation', 'owner');
      await expect(service.claim('conversation', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    },
  );
  it('only allows an admin to transfer and preserves the start time', async () => {
    const { service, row } = fixture();
    await service.claim('conversation', 'owner');
    const started = row.attendanceStartedAt;
    await expect(
      service.assign('conversation', 'other', 'other'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.assign('conversation', 'admin', 'other'),
    ).resolves.toMatchObject({
      attendanceStatus: 'in_progress',
      assignedUserId: 'other',
      attendanceStartedAt: started,
    });
  });
  it.each(['inactive', 'missing'])(
    'rejects assigning to %s',
    async (target) => {
      const { service, writes } = fixture();
      await service.claim('conversation', 'owner');
      await expect(
        service.assign('conversation', 'admin', target),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(writes).toHaveLength(1);
    },
  );
  it.each(['claim', 'finish', 'reopen', 'assign'] as const)(
    'rejects inactive or missing actors for %s',
    async (action) => {
      const { service, writes } = fixture();
      for (const actor of ['inactive', 'missing']) {
        await expect(
          service[action]('conversation', actor, 'other'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      expect(writes).toHaveLength(0);
    },
  );
  it('returns 404 for a missing conversation', async () => {
    const { service, remove } = fixture();
    remove();
    await expect(service.claim('conversation', 'owner')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('finishes for the owner, rejects another user and preserves the owner', async () => {
    const { service } = fixture();
    await service.claim('conversation', 'owner');
    await expect(
      service.finish('conversation', 'other'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.finish('conversation', 'owner'),
    ).resolves.toMatchObject({
      attendanceStatus: 'finished',
      assignedUserId: 'owner',
      attendanceFinishedAt: expect.any(Date) as unknown,
    });
  });
  it('allows an active admin to finish another user attendance', async () => {
    const { service } = fixture();
    await service.claim('conversation', 'owner');
    await expect(
      service.finish('conversation', 'admin'),
    ).resolves.toMatchObject({
      attendanceStatus: 'finished',
      assignedUserId: 'owner',
    });
  });
  it('reopens for any active user, preserves timestamps and permits a new claim', async () => {
    const { service, row } = fixture();
    await service.claim('conversation', 'owner');
    await service.finish('conversation', 'owner');
    const started = row.attendanceStartedAt;
    const finished = row.attendanceFinishedAt;
    await expect(
      service.reopen('conversation', 'other'),
    ).resolves.toMatchObject({
      attendanceStatus: 'waiting',
      assignedUserId: null,
      attendanceStartedAt: started,
      attendanceFinishedAt: finished,
    });
    await service.claim('conversation', 'other');
    expect(row.attendanceFinishedAt).toBeNull();
  });
  it('rejects invalid transitions without writes', async () => {
    const { service, writes } = fixture();
    await expect(
      service.finish('conversation', 'owner'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reopen('conversation', 'owner'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.assign('conversation', 'admin', 'other'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toHaveLength(0);
  });
  it('only writes attendance fields and preserves contact and conversation identifiers', async () => {
    const { service, row, writes } = fixture();
    const original = {
      contactId: row.contactId,
      contact: row.contact,
      remoteJid: row.remoteJid,
      connectionId: row.connectionId,
    };
    await service.claim('conversation', 'owner');
    await service.assign('conversation', 'admin', 'other');
    await service.finish('conversation', 'other');
    await service.reopen('conversation', 'owner');
    expect(row).toMatchObject(original);
    for (const write of writes) {
      expect(
        Object.keys(write).every((key) =>
          [
            'attendanceStatus',
            'assignedUserId',
            'attendanceStartedAt',
            'attendanceFinishedAt',
          ].includes(key),
        ),
      ).toBe(true);
    }
  });
});
