import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.getOrThrow<string[]>('CORS_ORIGINS') });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
}

export async function createApplication(): Promise<INestApplication> {
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    forceCloseConnections: true,
  });
  try {
    configureApplication(app);
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

export async function startApplication(
  factory: () => Promise<INestApplication> = createApplication,
): Promise<INestApplication> {
  const app = await factory();
  try {
    const config = app.get(ConfigService);
    await app.listen(config.getOrThrow<number>('PORT'), config.getOrThrow<string>('HOST'));
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}
