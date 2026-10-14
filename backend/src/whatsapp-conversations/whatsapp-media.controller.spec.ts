import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthGuard } from '../auth/guards/auth.guard';
import { UsersService } from '../users/users.service';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
import { WhatsappMediaController } from './whatsapp-media.controller';
import { WhatsappMediaService } from './whatsapp-media.service';

describe('Authenticated media HTTP endpoint', () => {
  let app: INestApplication<App>;
  const jwt = {
    sign: (payload: { sub: string }) => payload.sub,
    verifyAsync: (token: string) =>
      ['active', 'inactive'].includes(token)
        ? Promise.resolve({ sub: token })
        : Promise.reject(new Error('invalid token')),
  };
  const media = { file: jest.fn() };
  const conversation = 'bcf2e8e8-9fa4-4e56-a7e0-03f8d59ec170',
    message = '72098c86-0c7a-4af8-9756-6f7745d5e6e6';
  const path = `/whatsapp-conversations/${conversation}/messages/${message}/media`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WhatsappMediaController],
      providers: [
        { provide: WhatsappMediaService, useValue: media },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: JwtService, useValue: jwt },
        {
          provide: UsersService,
          useValue: {
            findActiveById: (id: string) =>
              Promise.resolve(id === 'active' ? { id, isActive: true } : null),
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
    media.file.mockReset();
  });
  it.each(['anonymous', 'invalid', 'inactive'])(
    'denies %s without opening the file',
    async (user) => {
      const req = request(app.getHttpServer()).get(path);
      if (user !== 'anonymous')
        req.set(
          'Authorization',
          'Bearer ' +
            (user === 'invalid' ? 'bad-token' : jwt.sign({ sub: user })),
        );
      await req.expect(401);
      expect(media.file).not.toHaveBeenCalled();
    },
  );
  it('streams only to an active authenticated user with safe private headers', async () => {
    media.file.mockResolvedValue({
      stream: Readable.from([Buffer.from('%PDF-1.7')]),
      size: 8,
      mimeType: 'application/pdf',
      kind: 'document',
      name: 'arquivo.pdf',
    });
    const result = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: 'active' }))
      .expect(200);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['content-disposition']).toContain('attachment');
    expect(media.file).toHaveBeenCalledWith(conversation, message);
  });
  it('returns 404 for a message outside the requested conversation', async () => {
    media.file.mockRejectedValue(new NotFoundException());
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: 'active' }))
      .expect(404);
  });
});
