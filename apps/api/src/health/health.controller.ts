import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/db.module.js';

@Controller()
export class HealthController {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  /** Liveness: the process is up. Never touches the database. */
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: the database answers. */
  @Get('ready')
  @HttpCode(200)
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }
  }
}
