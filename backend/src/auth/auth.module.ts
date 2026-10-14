import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminGuard } from './guards/admin.guard';
import { AuthGuard } from './guards/auth.guard';
import { DeletePermissionGuard } from './guards/delete-permission.guard';
import { UsersModule } from '../users/users.module';

function getTokenExpiration(config: ConfigService): number {
  const value = config.get<string>('JWT_EXPIRES_IN', '3600');
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    throw new Error('JWT_EXPIRES_IN deve ser um inteiro positivo em segundos.');
  }
  return seconds;
}

function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET')?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET é obrigatório e deve ter pelo menos 32 caracteres.',
    );
  }
  return secret;
}

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: getJwtSecret(config),
        signOptions: { expiresIn: getTokenExpiration(config) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AdminGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: DeletePermissionGuard },
  ],
})
export class AuthModule {}
