import request from 'supertest';
import { createTestApp, type TestApp } from './support/app.js';
import { PASSWORD, sessionCookie, signUpOwner, uniqueEmail } from './support/auth.js';

describe('authentication', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('sign-up creates a clinic with its owner and signs the owner in', async () => {
    const owner = await signUpOwner(t, 'Consultório Aurora');
    expect(owner.user).toMatchObject({ role: 'owner', name: 'Dona Ana' });
    expect(owner.user).not.toHaveProperty('passwordHash');
    const me = await request(t.http).get('/api/me').set('Cookie', owner.cookie).expect(200);
    expect(me.body).toEqual(owner.user);
  });

  it('the session cookie is HttpOnly, Secure, SameSite and host-only', async () => {
    const res = await request(t.http)
      .post('/api/auth/sign-up')
      .send({ clinicName: 'Clínica', name: 'Fulana', email: uniqueEmail(), password: PASSWORD })
      .expect(201);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.includes('sid='))!;
    expect(cookie).toMatch(/^__Host-sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('a second sign-up with the same email is a 409, whatever the case', async () => {
    const email = uniqueEmail();
    const body = { clinicName: 'Clínica', name: 'Fulana', password: PASSWORD };
    await request(t.http).post('/api/auth/sign-up').send({ ...body, email }).expect(201);
    await request(t.http).post('/api/auth/sign-up').send({ ...body, email: email.toUpperCase() }).expect(409);
  });

  it('rejects weak passwords and invalid input with 400', async () => {
    await request(t.http)
      .post('/api/auth/sign-up')
      .send({ clinicName: 'Clínica', name: 'Fulana', email: uniqueEmail(), password: 'short' })
      .expect(400);
    await request(t.http).post('/api/auth/sign-up').send({ email: 'not-an-email' }).expect(400);
  });

  it('wrong password and unknown email get the same 401', async () => {
    const owner = await signUpOwner(t);
    const wrong = await request(t.http)
      .post('/api/auth/sign-in')
      .send({ email: owner.user.email, password: 'wrong password!!' })
      .expect(401);
    const unknown = await request(t.http)
      .post('/api/auth/sign-in')
      .send({ email: uniqueEmail(), password: 'wrong password!!' })
      .expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('sign-in issues a new session, and sign-out ends it', async () => {
    const owner = await signUpOwner(t);
    const res = await request(t.http)
      .post('/api/auth/sign-in')
      .send({ email: owner.user.email, password: PASSWORD })
      .expect(200);
    const cookie = sessionCookie(res);
    await request(t.http).get('/api/me').set('Cookie', cookie).expect(200);
    await request(t.http).post('/api/auth/sign-out').set('Cookie', cookie).expect(204);
    await request(t.http).get('/api/me').set('Cookie', cookie).expect(401);
  });

  it('every route requires a session by default', async () => {
    await request(t.http).get('/api/me').expect(401);
    await request(t.http).get('/api/staff').expect(401);
    await request(t.http).get('/api/me').set('Cookie', '__Host-sid=forged-token').expect(401);
  });

  it('refuses a cross-site write (CSRF)', async () => {
    await request(t.http)
      .post('/api/auth/sign-in')
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: uniqueEmail(), password: PASSWORD })
      .expect(403);
  });
});
