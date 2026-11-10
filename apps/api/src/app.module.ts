import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthenticationModule } from '@nestjs/authentication';
import { AuthorizationModule } from '@nestjs/authorization';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailModule } from '@nestjs/mail';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { type Env, validateEnv } from './config/env.js';
import { ClockModule } from './common/clock.js';
import { DbModule } from './db/db.module.js';
import { PgExceptionFilter } from './db/pg-exception.filter.js';
import { HealthModule } from './health/health.module.js';
import { mailTransport } from './mail/mail.config.js';
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
    TenancyModule,
    AuthModule,
    StaffModule,
    PatientsModule,
    RoomsModule,
    SessionTypesModule,
    AvailabilityModule,
    AppointmentsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: PgExceptionFilter }],
})
export class AppModule {}
