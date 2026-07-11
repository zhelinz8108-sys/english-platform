import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { Public } from './auth/guards.js';
import { DatabaseService } from './infrastructure/database.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('live')
  @Public()
  live() {
    return { status: 'ok', checkedAt: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  async ready() {
    await sql`select 1`.execute(this.database.db);
    return { status: 'ready', database: 'ok', checkedAt: new Date().toISOString() };
  }
}
