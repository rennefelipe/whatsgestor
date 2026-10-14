jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  DisconnectReason: {},
  useMultiFileAuthState: jest.fn(),
}));
import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthGuard } from '../auth/guards/auth.guard';
import { UsersService } from '../users/users.service';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
import { ProfilePhotosController } from './profile-photos.controller';
import { ProfilePhotosService } from './profile-photos.service';

describe('Authenticated profile photo endpoints', () => {
  let app: INestApplication<App>;
  const jwt = {
    sign: (payload: { sub: string }) => payload.sub,
    verifyAsync: (token: string) =>
      ['active', 'inactive'].includes(token)
        ? Promise.resolve({ sub: token })
        : Promise.reject(new Error('invalid token')),
  };
  const media = { conversation: jest.fn(), contact: jest.fn() };
  const conversation = 'bcf2e8e8-9fa4-4e56-a7e0-03f8d59ec170';
  const path = `/whatsapp-profile-photos/conversations/${conversation}`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProfilePhotosController],
      providers: [
        { provide: ProfilePhotosService, useValue: media },
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
    media.conversation.mockReset();
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
      expect(media.conversation).not.toHaveBeenCalled();
    },
  );
  it('streams only to an active authenticated user with safe private headers', async () => {
    media.conversation.mockResolvedValue({
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      mime: 'image/png',
    });
    const result = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: 'active' }))
      .expect(200);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(media.conversation).toHaveBeenCalledWith(conversation);
  });
  it('returns 404 for a message outside the requested conversation', async () => {
    media.conversation.mockRejectedValue(new NotFoundException());
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: 'active' }))
      .expect(404);
  });
  it('returns 204 for an unavailable photo without exposing any URL', async () => {
    media.conversation.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer active')
      .expect(204);
  });
  it('protects the contact endpoint with the same global guard', async () => {
    await request(app.getHttpServer())
      .get('/whatsapp-profile-photos/contacts/' + conversation)
      .expect(401);
    expect(media.contact).not.toHaveBeenCalled();
  });
});
