import {
  Controller,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Post,
} from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import { OutboxRelay } from '@nestjs/outbox';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { SeriesService } from '../appointments/series.service.js';
import { assertBearer } from '../common/bearer-secret.js';
import type { Env } from '../config/env.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ReminderScheduler } from '../notifications/reminder.scheduler.js';

/** At most this many relay rounds per run, so one call stays short. */
const MAX_RELAY_ROUNDS = 20;

/**
 * The periodic work, in one place. Every step is idempotent and safe to run concurrently, so it
 * can be triggered both in-process and from outside at the same time.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly series: SeriesService,
    private readonly reminders: ReminderScheduler,
    private readonly relay: OutboxRelay,
  ) {}

  async run() {
    const seriesHorizon = await this.series.extendHorizons();
    const remindersQueued = await this.reminders.enqueueDue();
    // Publish now rather than wait for the poll: the instance may go to sleep right after.
    let published = 0;
    for (let round = 0; round < MAX_RELAY_ROUNDS; round++) {
      const result = await this.relay.runOnce();
      published += result.published;
      if (!result.claimed) break;
    }
    const summary = { seriesHorizon, remindersQueued, messagesPublished: published };
    this.logger.log(`jobs run: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** While awake, run every few minutes; free hosting sleeps, hence the external trigger too. */
  onApplicationBootstrap() {
    const minutes = this.config.get('JOBS_INTERVAL_MINUTES', { infer: true });
    if (!minutes || this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => {
      this.run().catch((error) => this.logger.error(`jobs run failed: ${error}`));
    }, minutes * 60_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }
}

@Controller('internal/jobs')
export class JobsController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly jobs: JobsService,
  ) {}

  /** For an external scheduler (GitHub Actions cron), with a bearer secret. */
  @Public()
  @Post('run')
  @HttpCode(200)
  async run(@Headers('authorization') authorization?: string) {
    assertBearer(authorization, this.config.get('JOBS_SECRET', { infer: true }));
    return this.jobs.run();
  }
}

@Module({ imports: [AppointmentsModule, NotificationsModule], controllers: [JobsController], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
