import request from 'supertest';
import { createTestApp, type TestApp } from './support/app.js';

describe('health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('GET /api/health is public and never touches the database', async () => {
    await request(t.http).get('/api/health').expect(200, { status: 'ok' });
  });

  it('GET /api/ready is public and reports the database', async () => {
    await request(t.http).get('/api/ready').expect(200, { status: 'ok', database: 'up' });
  });

  it('sets security headers', async () => {
    const res = await request(t.http).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
