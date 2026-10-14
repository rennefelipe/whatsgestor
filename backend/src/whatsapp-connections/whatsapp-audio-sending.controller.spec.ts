import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import {
  UnauthorizedException,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  AttachmentUploadGuard,
  WhatsappAudioSendingController,
} from './whatsapp-attachment-sending.controller';
import { WhatsappAttachmentSendingService } from './whatsapp-attachment-sending.service';
import { AUDIO_UPLOAD_MAX_BYTES } from './outbound-audio';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('./baileys/whatsapp-session-manager.service', () => ({
  WhatsappSessionManagerService: class {},
}));

describe('authenticated recorded audio multipart route', () => {
  let app: INestApplication;
  const preflight = jest.fn();
  const sendAudio = jest.fn().mockResolvedValue({ id: 'stored-audio' });
  const conversationId = randomUUID();
  const path = `/whatsapp-conversations/${conversationId}/messages/audio`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WhatsappAudioSendingController],
      providers: [
        AttachmentUploadGuard,
        {
          provide: WhatsappAttachmentSendingService,
          useValue: { preflight, sendAudio },
        },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate(context: ExecutionContext) {
              const request = context.switchToHttp().getRequest<{
                headers: Record<string, string>;
                user: unknown;
              }>();
              if (request.headers.authorization !== 'Bearer synthetic')
                throw new UnauthorizedException();
              request.user = {
                id: randomUUID(),
                isActive: true,
                isAdmin: false,
              };
              return true;
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    preflight.mockReset().mockResolvedValue(undefined);
    sendAudio.mockClear();
  });

  it('accepts one recording and forwards the authenticated actor and idempotency key', async () => {
    const attemptId = randomUUID();
    const response = await request(app.getHttpServer() as Server)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .set('Idempotency-Key', attemptId)
      .attach('file', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]), {
        filename: 'gravacao.webm',
        contentType: 'audio/webm',
      })
      .expect(201);
    expect(response.body).toEqual({ id: 'stored-audio' });
    expect(preflight).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ isActive: true }),
    );
    expect(sendAudio).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ isActive: true }),
      attemptId,
      expect.objectContaining({
        originalname: 'gravacao.webm',
        mimetype: 'audio/webm',
      }),
    );
  });

  it('requires authentication and a UUID idempotency key before parsing the recording', async () => {
    await request(app.getHttpServer() as Server)
      .post(path)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .attach('file', Buffer.from('recording'), 'gravacao.webm')
      .expect(400);
    expect(preflight).not.toHaveBeenCalled();
    expect(sendAudio).not.toHaveBeenCalled();
  });

  it('rejects extra fields, multiple files and recordings above 16 MiB', async () => {
    const headers = (requestBuilder: request.Test) =>
      requestBuilder
        .set('Authorization', 'Bearer synthetic')
        .set('Idempotency-Key', randomUUID());
    await headers(request(app.getHttpServer() as Server).post(path))
      .field('durationSeconds', '10')
      .attach('file', Buffer.from('recording'), 'gravacao.webm')
      .expect(400);
    await headers(request(app.getHttpServer() as Server).post(path))
      .attach('file', Buffer.from('one'), 'one.webm')
      .attach('file', Buffer.from('two'), 'two.webm')
      .expect(400);
    await headers(request(app.getHttpServer() as Server).post(path))
      .attach('file', Buffer.alloc(AUDIO_UPLOAD_MAX_BYTES + 1), {
        filename: 'large.webm',
        contentType: 'audio/webm',
      })
      .expect(413);
    expect(sendAudio).not.toHaveBeenCalled();
  });
});
