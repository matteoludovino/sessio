import type { INestApplication } from '@nestjs/common';
import { InMemoryMailTransport, MailTransport } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';

export interface TestApp {
  app: INestApplication;
  /** Every mail the app sends, readable by the test. */
  mailbox: InMemoryMailTransport;
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailTransport)
    .useValue(mailbox)
    .compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return { app, mailbox, http: app.getHttpServer() };
}
