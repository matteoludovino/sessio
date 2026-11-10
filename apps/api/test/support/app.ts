import type { INestApplication } from '@nestjs/common';
import { InMemoryMailTransport, MailTransport } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';
import { Clock } from '../../src/common/clock.js';

/** A clock the test moves by hand: time rules are tested without waiting. */
export class FakeClock extends Clock {
  private current: Date | null = null;

  override now(): Date {
    return this.current ? new Date(this.current) : new Date();
  }

  set(instant: Date | string) {
    this.current = new Date(instant);
  }

  /** Back to real time. */
  reset() {
    this.current = null;
  }
}

export interface TestApp {
  app: INestApplication;
  /** Every mail the app sends, readable by the test. */
  mailbox: InMemoryMailTransport;
  clock: FakeClock;
  http: ReturnType<INestApplication['getHttpServer']>;
}

/**
 * Boots the real application (same setup as main.ts) against the test database.
 * Module options are evaluated when AppModule's file is imported, so the environment
 * is set first and the module is imported afterwards.
 */
export async function createTestApp(): Promise<TestApp> {
  process.env.DATABASE_URL = inject('databaseUrl');
  process.env.NODE_ENV = 'test';
  process.env.WEB_ORIGIN = 'http://localhost:5173';
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');
  const mailbox = new InMemoryMailTransport();
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailTransport)
    .useValue(mailbox)
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return { app, mailbox, clock, http: app.getHttpServer() };
}
