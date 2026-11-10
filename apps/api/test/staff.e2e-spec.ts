import request from 'supertest';
import { StaffInvitationMail } from '../src/staff/staff-invitation.mail.js';
import { createTestApp, type TestApp } from './support/app.js';
import { addStaff, invitationToken, PASSWORD, signUpOwner, uniqueEmail } from './support/auth.js';

describe('staff and invitations', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('the owner invites; the link goes to the invitee only, never to the owner', async () => {
    const owner = await signUpOwner(t, 'Clínica Horizonte');
    const email = uniqueEmail('psy');
    const res = await request(t.http)
      .post('/api/staff/invitations')
      .set('Cookie', owner.cookie)
      .send({ email, name: 'Dr. Paulo', role: 'psychologist' })
      .expect(201);

    // The response carries no token: the owner can't accept on the psychologist's behalf.
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
    // The mail waits in the outbox, committed with the invitation, until the relay delivers it.
    t.mailbox.assertNotSent({ to: email });
    await t.deliver();
    const mail = t.mailbox.assertSent({ to: email, mail: StaffInvitationMail });
    expect(mail.subject).toBe('Convite para a equipe de Clínica Horizonte');
    expect(mail.link('/convite').searchParams.get('token')).toBeTruthy();
  });

  it('accepting creates the account with the invited role, in the inviting clinic, and signs in', async () => {
    const owner = await signUpOwner(t);
    const psy = await addStaff(t, owner, 'psychologist', 'Dra. Júlia');
    expect(psy.user).toMatchObject({ role: 'psychologist', clinicId: owner.user.clinicId, name: 'Dra. Júlia' });
    await request(t.http).get('/api/me').set('Cookie', psy.cookie).expect(200);
  });

  it('an invitation works once, even when accepted twice at the same time', async () => {
    const owner = await signUpOwner(t);
    const email = uniqueEmail();
    await request(t.http)
      .post('/api/staff/invitations')
      .set('Cookie', owner.cookie)
      .send({ email, name: 'Recepção', role: 'reception' })
      .expect(201);
    const token = await invitationToken(t, email);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(t.http).post('/api/invitations/accept').send({ token, password: PASSWORD })),
    );
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 410, 410, 410, 410]);
  });

  it('an unknown token is a 410', async () => {
    await request(t.http)
      .post('/api/invitations/accept')
      .send({ token: 'x'.repeat(43), password: PASSWORD })
      .expect(410);
  });

  it('only the owner invites and manages; reception lists; psychologists do neither', async () => {
    const owner = await signUpOwner(t);
    const reception = await addStaff(t, owner, 'reception');
    const psy = await addStaff(t, owner, 'psychologist');
    const invite = { email: uniqueEmail(), name: 'Alguém', role: 'psychologist' };

    await request(t.http).post('/api/staff/invitations').set('Cookie', reception.cookie).send(invite).expect(403);
    await request(t.http).post('/api/staff/invitations').set('Cookie', psy.cookie).send(invite).expect(403);
    await request(t.http).patch(`/api/staff/${psy.user.id}`).set('Cookie', reception.cookie).send({ active: false }).expect(403);

    const list = await request(t.http).get('/api/staff').set('Cookie', reception.cookie).expect(200);
    expect(list.body.map((m: { role: string }) => m.role).sort()).toEqual(['owner', 'psychologist', 'reception']);
    await request(t.http).get('/api/staff').set('Cookie', psy.cookie).expect(403);
  });

  it('deactivating someone signs them out immediately and blocks sign-in', async () => {
    const owner = await signUpOwner(t);
    const psy = await addStaff(t, owner, 'psychologist');
    await request(t.http).patch(`/api/staff/${psy.user.id}`).set('Cookie', owner.cookie).send({ active: false }).expect(200);

    await request(t.http).get('/api/me').set('Cookie', psy.cookie).expect(401);
    await request(t.http).post('/api/auth/sign-in').send({ email: psy.user.email, password: PASSWORD }).expect(401);
  });

  it('a clinic keeps at least one active owner', async () => {
    const owner = await signUpOwner(t);
    await request(t.http)
      .patch(`/api/staff/${owner.user.id}`)
      .set('Cookie', owner.cookie)
      .send({ role: 'reception' })
      .expect(400);
  });

  it('another clinic’s staff is invisible: 404, never 403 (IDOR)', async () => {
    const clinicA = await signUpOwner(t, 'Clínica A');
    const psyA = await addStaff(t, clinicA, 'psychologist');
    const clinicB = await signUpOwner(t, 'Clínica B');

    await request(t.http).patch(`/api/staff/${psyA.user.id}`).set('Cookie', clinicB.cookie).send({ active: false }).expect(404);
    const listB = await request(t.http).get('/api/staff').set('Cookie', clinicB.cookie).expect(200);
    expect(listB.body.map((m: { id: string }) => m.id)).toEqual([clinicB.user.id]);
    // psyA is still active
    await request(t.http).get('/api/me').set('Cookie', psyA.cookie).expect(200);
  });
});
