import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import {
  UnauthorizedException,
  type INestApplication,
  type ExecutionContext,
} from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  WhatsappAttachmentSendingController,
  AttachmentUploadGuard,
} from './whatsapp-attachment-sending.controller';
import { WhatsappAttachmentSendingService } from './whatsapp-attachment-sending.service';
import { validateAttachment } from './attachment-validation';
import { attachmentFixture } from '../../test/attachment-fixture';
import type { AttachmentUpload } from './attachment-validation';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('./baileys/whatsapp-session-manager.service', () => ({
  WhatsappSessionManagerService: class {},
}));

describe('authenticated multipart attachment route', () => {
  let app: INestApplication;
  const preflight = jest.fn();
  const sent = jest.fn(
    async (
      _id: string,
      _user: unknown,
      _attempt: string,
      file: AttachmentUpload,
    ) => ({ id: 'stored', media: await validateAttachment(file) }),
  );
  const path = `/whatsapp-conversations/${randomUUID()}/messages/attachments`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WhatsappAttachmentSendingController],
      providers: [
        AttachmentUploadGuard,
        {
          provide: WhatsappAttachmentSendingService,
          useValue: { preflight, send: sent },
        },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate(context: ExecutionContext) {
              const req = context.switchToHttp().getRequest<{
                headers: Record<string, string>;
                user: unknown;
              }>();
              if (req.headers.authorization !== 'Bearer synthetic')
                throw new UnauthorizedException();
              req.user = { id: randomUUID(), isActive: true, isAdmin: true };
              return true;
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    preflight.mockReset().mockResolvedValue(undefined);
    sent.mockClear();
  });
  it.each(['jpeg', 'png', 'webp', 'pdf'] as const)(
    'accepts one %s through actual multipart parsing',
    async (format) => {
      const file = await attachmentFixture(format);
      await request(app.getHttpServer() as Server)
        .post(path)
        .set('Authorization', 'Bearer synthetic')
        .set('Idempotency-Key', randomUUID())
        .attach('file', file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        })
        .expect(201);
      expect(preflight).toHaveBeenCalledTimes(1);
      expect(sent).toHaveBeenCalledTimes(1);
    },
  );
  it('requires authentication, attempt UUID, one file and no extra multipart fields', async () => {
    await request(app.getHttpServer() as Server)
      .post(path)
      .expect(401);
    expect(preflight).not.toHaveBeenCalled();
    const file = await attachmentFixture('png');
    await request(app.getHttpServer() as Server)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .attach('file', file.buffer, 'teste.png')
      .expect(400);
    expect(preflight).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .set('Idempotency-Key', randomUUID())
      .field('unexpected', 'value')
      .attach('file', file.buffer, 'teste.png')
      .expect(400);
    expect(sent).not.toHaveBeenCalled();
    await request(app.getHttpServer() as Server)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .set('Idempotency-Key', randomUUID())
      .attach('file', file.buffer, 'teste.png')
      .attach('file', file.buffer, 'second.png')
      .expect(400);
    expect(sent).not.toHaveBeenCalled();
  });
  it('rejects oversized PDF at the parser boundary', async () => {
    await request(app.getHttpServer() as Server)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .set('Idempotency-Key', randomUUID())
      .attach('file', Buffer.alloc(20 * 1024 * 1024 + 1), {
        filename: 'large.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);
    expect(sent).not.toHaveBeenCalled();
  });
  it('preserves UTF-8 names through the multipart parser and sanitization', async () => {
    const file = await attachmentFixture('pdf');
    const response = await request(app.getHttpServer() as Server)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .set('Idempotency-Key', randomUUID())
      .attach('file', file.buffer, {
        filename: 'Contrato João.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(
      (response.body as { media: { originalName: string } }).media.originalName,
    ).toBe('Contrato João.pdf');
  });
});
