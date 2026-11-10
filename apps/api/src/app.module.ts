import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthenticationModule } from '@nestjs/authentication';
import { AuthorizationModule } from '@nestjs/authorization';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import { MailModule } from '@nestjs/mail';
import { OutboxModule, OutboxStorage } from '@nestjs/outbox';
import { fromDrizzle, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { type Env, validateEnv } from './config/env.js';
import { ClockModule } from './common/clock.js';
import { type Database, DbModule } from './db/db.module.js';
import { PgExceptionFilter } from './db/pg-exception.filter.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { mailTransport } from './mail/mail.config.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PublicSessionsModule } from './public/public-sessions.module.js';
import { PatientsModule } from './patients/patients.module.js';
import { RoomsModule } from './rooms/rooms.module.js';
import { SessionTypesModule } from './session-types/session-types.module.js';
import { StaffModule } from './staff/staff.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DbModule,
    ClockModule,
    // Authentication first: its global guard sets the user that authorization reads.
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        session: {
          absoluteTtl: '12h', // a workday at most, however active
          idleTtl: '2h',
          trustedOrigins: [config.get('WEB_ORIGIN', { infer: true })],
        },
      }),
    }),
    // Denies by default: a route without @Can() (or @Public()) is closed.
    AuthorizationModule.forRoot(),
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        transport: mailTransport(config),
        from: config.get('MAIL_FROM', { infer: true }),
      }),
    }),
    // Reliable delivery: messages commit with the rows that cause them, then the relay publishes
    // them with retries; consumers deduplicate through their inboxes.
    OutboxModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        relay: { enabled: config.get('OUTBOX_RELAY', { infer: true }) === 'on', pollInterval: '5s' },
        retry: { attempts: 8, backoff: { delay: '30s', maxDelay: '30m' } },
      }),
    }),
    TenancyModule,
    AuthModule,
    StaffModule,
    PatientsModule,
    RoomsModule,
    SessionTypesModule,
    AvailabilityModule,
    AppointmentsModule,
    NotificationsModule,
    PublicSessionsModule,
    JobsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: PgExceptionFilter },
    {
      // The outbox's tables live in our database (schema nest_outbox, created by our migrations).
      provide: PostgresOutboxStore,
      inject: [getDrizzleToken(), OutboxStorage],
      useFactory: (db: Database, storage: OutboxStorage) => new PostgresOutboxStore({ executor: fromDrizzle(db) }, storage),
    },
  ],
})
export class AppModule {}
