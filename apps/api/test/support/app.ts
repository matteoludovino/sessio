import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';

/**
 * Boots the real application (same setup as main.ts) against the test database.
 * Module options are evaluated when AppModule's file is imported, so the environment
 * is set first and the module is imported afterwards.
 */
export async function createTestApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = inject('databaseUrl');
  process.env.NODE_ENV = 'test';
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}
