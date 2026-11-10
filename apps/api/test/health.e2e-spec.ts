import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/app.js';

describe('health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health is up without touching the database', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok' });
  });

  it('GET /api/ready reports the database', async () => {
    await request(app.getHttpServer()).get('/api/ready').expect(200, { status: 'ok', database: 'up' });
  });
});
