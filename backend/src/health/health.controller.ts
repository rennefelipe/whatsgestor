import { Public } from '../auth/decorators/public.decorator';
import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly databaseSource: DataSource) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  live() {
    return { status: 'ok' };
  }

  @Get(['ready', 'database'])
  @Header('Cache-Control', 'no-store')
  async database() {
    try {
      if (!this.databaseSource.isInitialized) throw new Error();
      await this.databaseSource.query('SELECT 1 AS ok');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}
