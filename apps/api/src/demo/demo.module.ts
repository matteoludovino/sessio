import { Controller, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, type OnApplicationBootstrap, Post } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { SeriesService } from '../appointments/series.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { assertBearer } from '../common/bearer-secret.js';
import type { Env } from '../config/env.js';
import { JobsModule, JobsService } from '../jobs/jobs.module.js';
import { DemoSeeder } from './demo.seeder.js';

/** Builds the demo clinic; only ever active on a deployment with DEMO_MODE=true. */
@Injectable()
export class DemoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoService.name);
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly seeder: DemoSeeder,
    private readonly series: SeriesService,
    private readonly jobs: JobsService,
  ) {}

  get enabled() {
    return this.config.get('DEMO_MODE', { infer: true });
  }

  /** Wipe, seed, generate the coming weeks, send the reminders that are due. One at a time. */
  reset() {
    this.running ??= this.rebuild().finally(() => (this.running = null));
    return this.running;
  }

  /** A fresh demo deployment fills itself on first boot. */
  async onApplicationBootstrap() {
    if (!this.enabled || this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    if (await this.seeder.isEmpty()) {
      this.logger.log('demo: empty database, seeding');
      await this.reset();
    }
  }

  private async rebuild() {
    const started = Date.now();
    await this.seeder.wipe();
    const clinicId = await this.seeder.seed();
    const horizon = await this.series.extendHorizons();
    await this.seeder.confirmSome(clinicId);
    const jobs = await this.jobs.run();
    const summary = { clinicId, horizon, remindersQueued: jobs.remindersQueued, ms: Date.now() - started };
    this.logger.log(`demo reset: ${JSON.stringify(summary)}`);
    return summary;
  }
}

@Controller('internal/demo')
export class DemoController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly demo: DemoService,
  ) {}

  /** Nightly, from the scheduler: visitors' changes are undone and the dates move with today. */
  @Public()
  @Post('reset')
  @HttpCode(200)
  reset(@Headers('authorization') authorization?: string) {
    if (!this.demo.enabled) throw new NotFoundException();
    assertBearer(authorization, this.config.get('JOBS_SECRET', { infer: true }));
    return this.demo.reset();
  }
}

@Module({
  imports: [AuthModule, AppointmentsModule, JobsModule],
  controllers: [DemoController],
  providers: [DemoSeeder, DemoService],
  exports: [DemoService],
})
export class DemoModule {}
