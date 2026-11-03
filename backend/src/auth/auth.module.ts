import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { DeletePermissionGuard } from './guards/delete-permission.guard';
import { TesterPermissionGuard } from './guards/tester-permission.guard';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET').trim(),
        signOptions: { algorithm: 'HS256' as const, expiresIn: config.getOrThrow<number>('JWT_EXPIRES_IN') },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TesterPermissionGuard },
    { provide: APP_GUARD, useClass: DeletePermissionGuard },
  ],
})
export class AuthModule {}
