import request from 'supertest';
import { DemoService } from '../src/demo/demo.module.js';
import { DEMO_PASSWORD, DEMO_STAFF } from '../src/demo/demo-data.js';
import { createTestApp, type TestApp } from './support/app.js';
import { type SignedIn, sessionCookie } from './support/auth.js';
import { as } from './support/client.js';

const DAY = 86_400_000;

describe('Demo clinic (own database: the reset wipes everything)', () => {
  let t: TestApp;
  const signIn = async (email: string): Promise<SignedIn> => {
    const res = await request(t.http).post('/api/auth/sign-in').send({ email, password: DEMO_PASSWORD }).expect(200);
    return { cookie: sessionCookie(res), user: res.body };
  };

  beforeAll(async () => {
    t = await createTestApp({ database: 'demoDatabaseUrl' });
    await t.app.get(DemoService).reset();
  });
  afterAll(() => t.app.close());

  it('builds a clinic with history and the coming weeks, through the real rules', async () => {
    const owner = await signIn(DEMO_STAFF.helena.email);
    const list = (from: number, to: number) =>
      as(t, owner).get(`/api/appointments?from=${new Date(Date.now() + from * DAY).toISOString()}&to=${new Date(Date.now() + to * DAY).toISOString()}`);

    const past = (await list(-42, 0).expect(200)).body as { status: string }[];
    expect(past.filter((a) => a.status === 'completed').length).toBeGreaterThan(20);
    expect(past.map((a) => a.status)).toEqual(expect.arrayContaining(['no_show', 'late_cancelled', 'cancelled']));

    const next = (await list(0, 28).expect(200)).body as { status: string }[];
    expect(next.length).toBeGreaterThan(25);
    expect(next.some((a) => a.status === 'confirmed')).toBe(true);

    const staff = (await as(t, owner).get('/api/staff').expect(200)).body as unknown[];
    expect(staff).toHaveLength(4);
  });

  it('resets to the same state, undoing what visitors changed', async () => {
    const owner = await signIn(DEMO_STAFF.helena.email);
    await as(t, owner).patch('/api/clinic', { name: 'Renomeada por um visitante' }).expect(200);
    await t.app.get(DemoService).reset();

    const again = await signIn(DEMO_STAFF.helena.email);
    expect((await as(t, again).get('/api/clinic').expect(200)).body.name).toBe('Clínica Equilíbrio');
    // The reset signed everyone out.
    await as(t, owner).get('/api/me').expect(401);
  });

  it("encrypts the psychologist's notes, readable only by the author", async () => {
    const rafael = await signIn(DEMO_STAFF.rafael.email);
    const patients = (await as(t, rafael).get('/api/patients').expect(200)).body as { id: string; name: string }[];
    const ana = patients.find((p) => p.name === 'Ana Beatriz Lima')!;
    const notes = (await as(t, rafael).get(`/api/patients/${ana.id}/notes`).expect(200)).body as { content: string; amendsNoteId: string | null }[];
    expect(notes).toHaveLength(4);
    expect(notes.filter((n) => n.amendsNoteId)).toHaveLength(1);

    const julia = await signIn(DEMO_STAFF.julia.email);
    await as(t, julia).get(`/api/patients/${ana.id}/notes`).expect(403);
  });

  it('keeps the shared demo accounts usable', async () => {
    const owner = await signIn(DEMO_STAFF.helena.email);
    const rafael = await signIn(DEMO_STAFF.rafael.email);
    await as(t, owner).patch(`/api/staff/${rafael.user.id}`, { active: false }).expect(400);
    await as(t, owner).patch(`/api/staff/${rafael.user.id}`, { role: 'reception' }).expect(400);
  });

  it('resets over HTTP only with the scheduler secret', async () => {
    await request(t.http).post('/api/internal/demo/reset').expect(401);
    await request(t.http).post('/api/internal/demo/reset').set('Authorization', 'Bearer wrong-secret-of-the-right-size!!').expect(401);
  });
});
