import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { UsersService } from '../users/users.service';

jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

import { WhatsappAttendanceService } from './whatsapp-attendance.service';
import { WhatsappConversationsController } from './whatsapp-conversations.controller';
import { WhatsappConversationsService } from './whatsapp-conversations.service';

describe('Whatsapp attendance HTTP contracts', () => {
  let app: INestApplication<App>;
  const id = 'bcf2e8e8-9fa4-4e56-a7e0-03f8d59ec170';
  const target = '72098c86-0c7a-4af8-9756-6f7745d5e6e6';
  const attendance = {
    claim: jest.fn(),
    finish: jest.fn(),
    reopen: jest.fn(),
    assign: jest.fn(),
  };
  const conversations = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findMessages: jest.fn(),
    updateContact: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WhatsappConversationsController],
      providers: [
        AdminGuard,
        { provide: WhatsappAttendanceService, useValue: attendance },
        { provide: WhatsappConversationsService, useValue: conversations },
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: (token: string) => Promise.resolve({ sub: token }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findActiveById: (actor: string) =>
              Promise.resolve(
                ['owner', 'admin'].includes(actor)
                  ? { id: actor, isAdmin: actor === 'admin', isActive: true }
                  : null,
              ),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of Object.values(attendance))
      method.mockResolvedValue({ id });
    conversations.findAll.mockResolvedValue({
      items: [{ id }],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    conversations.findOne.mockResolvedValue({ id });
    conversations.findMessages.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    conversations.updateContact.mockResolvedValue({ id });
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['claim', 'finish', 'reopen'] as const)(
    'routes %s using the authenticated user ID',
    async (action) => {
      await request(app.getHttpServer())
        .post(`/whatsapp-conversations/${id}/attendance/${action}`)
        .auth('owner', { type: 'bearer' })
        .expect(200);
      expect(attendance[action]).toHaveBeenCalledWith(id, 'owner');
    },
  );
  it('rejects anonymous, inactive or nonexistent users', async () => {
    const path = `/whatsapp-conversations/${id}/attendance/claim`;
    await request(app.getHttpServer()).post(path).expect(401);
    for (const actor of ['inactive', 'missing']) {
      await request(app.getHttpServer())
        .post(path)
        .auth(actor, { type: 'bearer' })
        .expect(401);
    }
    expect(attendance.claim).not.toHaveBeenCalled();
  });
  it('restricts transfer to administrators and validates the target UUID', async () => {
    const path = `/whatsapp-conversations/${id}/attendance/assign`;
    await request(app.getHttpServer())
      .patch(path)
      .auth('owner', { type: 'bearer' })
      .send({ assignedUserId: target })
      .expect(403);
    for (const body of [
      {},
      { assignedUserId: null },
      { assignedUserId: 'invalid' },
      { assignedUserId: target, extra: true },
    ]) {
      await request(app.getHttpServer())
        .patch(path)
        .auth('admin', { type: 'bearer' })
        .send(body)
        .expect(400);
    }
    expect(attendance.assign).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch(path)
      .auth('admin', { type: 'bearer' })
      .send({ assignedUserId: target })
      .expect(200);
    expect(attendance.assign).toHaveBeenCalledWith(id, 'admin', target);
  });
  it('rejects invalid conversation UUIDs and propagates 409 conflicts', async () => {
    await request(app.getHttpServer())
      .post('/whatsapp-conversations/invalid/attendance/claim')
      .auth('owner', { type: 'bearer' })
      .expect(400);
    attendance.claim.mockRejectedValueOnce(
      new ConflictException('Conversa ocupada.'),
    );
    await request(app.getHttpServer())
      .post(`/whatsapp-conversations/${id}/attendance/claim`)
      .auth('owner', { type: 'bearer' })
      .expect(409);
  });
  it('preserves existing list, detail, message and contact routes', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/whatsapp-conversations')
      .auth('owner', { type: 'bearer' })
      .expect(200);
    await request(server)
      .get(`/whatsapp-conversations/${id}`)
      .auth('owner', { type: 'bearer' })
      .expect(200);
    await request(server)
      .get(`/whatsapp-conversations/${id}/messages`)
      .auth('owner', { type: 'bearer' })
      .expect(200);
    await request(server)
      .patch(`/whatsapp-conversations/${id}/contact`)
      .auth('owner', { type: 'bearer' })
      .send({ contactId: target })
      .expect(200);
    await request(server)
      .patch(`/whatsapp-conversations/${id}/contact`)
      .auth('owner', { type: 'bearer' })
      .send({ contactId: null })
      .expect(200);
    expect(conversations.updateContact).toHaveBeenCalledWith(id, target);
    expect(conversations.updateContact).toHaveBeenCalledWith(id, null);
  });
});
