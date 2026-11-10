import { timingSafeEqual } from 'node:crypto';
import { Controller, Headers, HttpCode, Logger, Module, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { SeriesService } from '../appointments/series.service.js';
import type { Env } from '../config/env.js';

/**
 * Periodic work, triggered from outside: free hosting sleeps when idle, so an in-process timer
 * can't be trusted. A scheduler (GitHub Actions cron) calls this with a bearer secret; every task
 * is idempotent and safe to run concurrently.
 */
@Controller('internal/jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly series: SeriesService,
  ) {}

  @Public()
  @Post('run')
  @HttpCode(200)
  async run(@Headers('authorization') authorization?: string) {
    const expected = Buffer.from(`Bearer ${this.config.get('JOBS_SECRET', { infer: true })}`);
    const given = Buffer.from(authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException();
    }
    const seriesHorizon = await this.series.extendHorizons();
    this.logger.log(`jobs run: ${JSON.stringify({ seriesHorizon })}`);
    return { seriesHorizon };
  }
}

@Module({ imports: [AppointmentsModule], controllers: [JobsController] })
export class JobsModule {}
