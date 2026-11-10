import { getDrizzleToken } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { appointments } from '../src/appointments/appointments.schema.js';
import type { Database } from '../src/db/db.module.js';
import { ReminderMail } from '../src/notifications/reminder.mail.js';
import { ReminderScheduler } from '../src/notifications/reminder.scheduler.js';
import { createTestApp, type TestApp } from './support/app.js';
import { addStaff, type SignedIn, signUpOwner } from './support/auth.js';
import { as, at } from './support/client.js';

// "Now": Sunday 2030-01-06 09:00 in São Paulo. Reminders go out 48h ahead; late if < 24h.
const NOW = at('2030-01-06 09:00');
const JOBS = { Authorization: 'Bearer dev-jobs-secret-change-me' };

describe('reminders and patient links', () => {
  let t: TestApp;
  let db: Database;
  let owner: SignedIn;
  let reception: SignedIn;
  let psy: SignedIn;
  let individual: string;
  let n = 0;

  const patient = async (email: string | null = `paciente${++n}@example.com`) =>
    (await as(t, reception).post('/api/patients', { name: `Joana Paciente ${n}`, psychologistId: psy.user.id, email })).body.id as string;
  const book = async (startsAt: string, patientId?: string) =>
    (await as(t, reception)
      .post('/api/appointments', { patientId: patientId ?? (await patient()), sessionTypeId: individual, mode: 'online', startsAt })
      .expect(201)).body as { id: string; patientId: string };
  const runJobs = () => request(t.http).post('/api/internal/jobs/run').set(JOBS).expect(200);
  const linkFrom = (email: string) => {
    const mail = t.mailbox.assertSent({ to: email, mail: ReminderMail });
    return mail.link('/sessao/').pathname.split('/').pop()!;
  };
  const emailOf = async (patientId: string) => (await as(t, reception).get(`/api/patients/${patientId}`)).body.email as string;

  beforeAll(async () => {
    t = await createTestApp();
    t.clock.set(NOW);
    db = t.app.get(getDrizzleToken());
    owner = await signUpOwner(t, 'Clínica Lembretes');
    reception = await addStaff(t, owner, 'reception');
    psy = await addStaff(t, owner, 'psychologist', 'Dra. Ana Lima');
    individual = (await as(t, owner).get('/api/session-types')).body.find((x: { name: string }) => x.name === 'Individual').id;
    const everyDay = { ranges: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '07:00', end: '22:00' })) };
    await as(t, owner).put(`/api/psychologists/${psy.user.id}/working-hours`, everyDay).expect(200);
  });

  afterAll(async () => {
    await t?.app.close();
  });

  beforeEach(() => {
    t.clock.set(NOW);
    t.mailbox.clear();
  });

  it('a session inside the lead time gets one neutral reminder with a link', async () => {
    const session = await book(at('2030-01-07 08:00')); // 23h ahead
    await runJobs();
    const email = await emailOf(session.patientId);
    const mail = t.mailbox.assertSent({ to: email, mail: ReminderMail });
    expect(mail.subject).toBe('Lembrete do seu horário: segunda-feira, 7 de janeiro, às 08:00');
    expect(mail.html).toContain('Dra. Ana Lima');
    // Neutral: no session type, no clinical vocabulary.
    expect(mail.html).not.toMatch(/Individual|terapia|psicolog/i);
    expect(mail.link('/sessao/').pathname).toMatch(/^\/sessao\/[\w-]+\.[\w-]+$/);

    const [row] = await db.select().from(appointments).where(eq(appointments.id, session.id));
    expect(row.reminderSentAt).not.toBeNull();
    // Running again doesn't send it twice.
    t.mailbox.clear();
    await runJobs();
    t.mailbox.assertNotSent({ to: email });
  });

  it('concurrent job runs send a reminder once', async () => {
    const session = await book(at('2030-01-08 07:00')); // 46h ahead
    // The in-process interval and the external scheduler may fire at the same moment.
    await Promise.all(Array.from({ length: 5 }, () => runJobs()));
    await t.deliver();
    expect(t.mailbox.filter({ to: await emailOf(session.patientId), mail: ReminderMail })).toHaveLength(1);
  });

  it('nothing before the lead time; the reminder comes when the session gets close', async () => {
    const session = await book(at('2030-01-08 10:00')); // 49h ahead
    const email = await emailOf(session.patientId);
    await runJobs();
    t.mailbox.assertNotSent({ to: email });
    t.clock.set(at('2030-01-06 11:00')); // 47h ahead
    await runJobs();
    t.mailbox.assertSent({ to: email, mail: ReminderMail });
  });

  it('no reminder for cancelled sessions or patients without email', async () => {
    const cancelled = await book(at('2030-01-07 10:00'));
    await as(t, reception).post(`/api/appointments/${cancelled.id}/cancel`, { by: 'clinic' }).expect(200);
    const noEmail = await book(at('2030-01-07 12:00'), await patient(null));
    await runJobs();
    t.mailbox.assertNotSent({ to: await emailOf(cancelled.patientId) });
    const [row] = await db.select().from(appointments).where(eq(appointments.id, noEmail.id));
    expect(row.reminderQueuedFor).toBeNull();
  });

  it('a reminder queued before a reschedule is dropped; the new time gets its own', async () => {
    const session = await book(at('2030-01-07 14:00'));
    const email = await emailOf(session.patientId);
    await t.app.get(ReminderScheduler).enqueueDue(); // queued, not delivered yet
    await as(t, reception).patch(`/api/appointments/${session.id}/schedule`, { startsAt: at('2030-01-07 16:00') }).expect(200);
    await t.deliver();
    t.mailbox.assertNotSent({ to: email }); // stale: the session moved
    await runJobs();
    const mail = t.mailbox.assertSent({ to: email, mail: ReminderMail });
    expect(mail.subject).toContain('às 16:00');
  });

  describe('the patient’s link', () => {
    /** A reminded session and its link, as the patient would receive them. */
    const remindedSession = async (startsAt: string) => {
      const session = await book(startsAt);
      await runJobs();
      return { ...session, token: linkFrom(await emailOf(session.patientId)) };
    };

    it('opening it changes nothing; the buttons do (mail scanners open links)', async () => {
      const { id, token } = await remindedSession(at('2030-01-07 18:00')); // 33h ahead
      const view = await request(t.http).get(`/api/public/sessions/${token}`).expect(200);
      expect(view.body).toMatchObject({
        clinicName: 'Clínica Lembretes',
        psychologistName: 'Dra. Ana Lima',
        status: 'scheduled',
        canConfirm: true,
        canCancel: true,
        lateCancelHours: 24,
        cancellingNowIsLate: false, // 33h of notice
      });
      // Nothing about the patient or the kind of session.
      expect(JSON.stringify(view.body)).not.toMatch(/Joana|Individual|patient/i);
      const [row] = await db.select().from(appointments).where(eq(appointments.id, id));
      expect(row.status).toBe('scheduled');
    });

    it('confirms, idempotently, and the front desk sees it', async () => {
      const { id, token } = await remindedSession(at('2030-01-07 19:00'));
      await request(t.http).post(`/api/public/sessions/${token}/confirm`).expect(200, { status: 'confirmed' });
      await request(t.http).post(`/api/public/sessions/${token}/confirm`).expect(200, { status: 'confirmed' });
      expect((await as(t, reception).get(`/api/appointments/${id}`)).body.status).toBe('confirmed');
    });

    it('cancels with the clinic’s policy: free with enough notice, late (chargeable) without', async () => {
      const early = await remindedSession(at('2030-01-07 20:00')); // 35h of notice
      await request(t.http).post(`/api/public/sessions/${early.token}/cancel`).send({ reason: 'Viagem' }).expect(200, { status: 'cancelled' });

      const late = await remindedSession(at('2030-01-07 07:00')); // 22h of notice
      const view = await request(t.http).get(`/api/public/sessions/${late.token}`).expect(200);
      expect(view.body.cancellingNowIsLate).toBe(true); // shown before the patient decides
      await request(t.http).post(`/api/public/sessions/${late.token}/cancel`).expect(200, { status: 'late_cancelled' });
      const [row] = await db.select().from(appointments).where(eq(appointments.id, late.id));
      expect(row).toMatchObject({ status: 'late_cancelled', cancelledBy: 'patient' });

      // A cancelled session's link can't do anything else.
      await request(t.http).post(`/api/public/sessions/${late.token}/confirm`).expect(422);
      expect((await request(t.http).get(`/api/public/sessions/${late.token}`)).body).toMatchObject({ canConfirm: false, canCancel: false });
    });

    it('a rescheduled session’s old link stops working (410)', async () => {
      const { id, token } = await remindedSession(at('2030-01-07 21:00'));
      await as(t, reception).patch(`/api/appointments/${id}/schedule`, { startsAt: at('2030-01-08 21:00') }).expect(200);
      const gone = await request(t.http).get(`/api/public/sessions/${token}`).expect(410);
      expect(gone.body.message).toMatch(/horário da sessão foi alterado/);
      await request(t.http).post(`/api/public/sessions/${token}/cancel`).expect(410);
    });

    it('once the session has started, the link can no longer cancel', async () => {
      const { token } = await remindedSession(at('2030-01-07 09:00'));
      t.clock.set(at('2030-01-07 09:10'));
      await request(t.http).post(`/api/public/sessions/${token}/cancel`).expect(422);
      expect((await request(t.http).get(`/api/public/sessions/${token}`)).body).toMatchObject({ canCancel: false, canConfirm: false });
    });

    it('a forged or tampered link is a 404', async () => {
      const { token } = await remindedSession(at('2030-01-07 11:00'));
      const [body, mac] = token.split('.');
      const tampered = `${body}.${mac.slice(0, -2)}${mac.endsWith('AA') ? 'BB' : 'AA'}`;
      await request(t.http).get(`/api/public/sessions/${tampered}`).expect(404);
      await request(t.http).get(`/api/public/sessions/${'x'.repeat(40)}`).expect(404);
      // Another appointment id with this link's signature doesn't pass either.
      const other = Buffer.from(`00000000-0000-4000-8000-000000000000.${Date.now()}`).toString('base64url');
      await request(t.http).post(`/api/public/sessions/${other}.${mac}/confirm`).expect(404);
    });
  });

  describe('sent notifications', () => {
    it('the front desk sees what was sent; in demo mode with the mail itself', async () => {
      await book(at('2030-01-07 13:00'));
      await runJobs();
      const list = await as(t, reception).get('/api/notifications').expect(200);
      const reminder = list.body.find((x: { kind: string }) => x.kind === 'appointment_reminder');
      expect(reminder).toMatchObject({ subject: expect.stringContaining('Lembrete do seu horário') });
      expect(reminder.html).toContain('/sessao/');
      await as(t, psy).get('/api/notifications').expect(403);
    });

    it('another clinic sees none of them', async () => {
      const other = await signUpOwner(t, 'Outra');
      expect((await as(t, other).get('/api/notifications').expect(200)).body).toEqual([]);
    });
  });
});
