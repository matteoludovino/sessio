import { getDrizzleToken } from '@nestjs/drizzle';
import { and, eq, inArray } from 'drizzle-orm';
import { appointments } from '../src/appointments/appointments.schema.js';
import type { Database } from '../src/db/db.module.js';
import { pgErrorCode } from '../src/db/errors.js';
import { createTestApp, type TestApp } from './support/app.js';
import { addStaff, type SignedIn, signUpOwner } from './support/auth.js';
import { as, at } from './support/client.js';

// Fixed "now": Sunday 2030-01-06 09:00 in São Paulo. Monday 2030-01-07 is the booking day.
const NOW = at('2030-01-06 09:00');
const MON = (hhmm: string) => at(`2030-01-07 ${hhmm}`);

describe('appointments', () => {
  let t: TestApp;
  let db: Database;
  let owner: SignedIn;
  let reception: SignedIn;
  let psyA: SignedIn;
  let psyB: SignedIn;
  let otherClinic: SignedIn;
  let individual: string; // 50 min
  let room1: string;
  let room2: string;
  let patientA: string; // of psyA
  let patientB: string; // of psyB
  let manyA: string[]; // 20 more patients of psyA

  const book = (who: SignedIn, body: Record<string, unknown>) =>
    as(t, who).post('/api/appointments', { sessionTypeId: individual, mode: 'online', ...body });

  beforeAll(async () => {
    t = await createTestApp();
    t.clock.set(NOW);
    db = t.app.get(getDrizzleToken());
    owner = await signUpOwner(t, 'Clínica Agenda');
    reception = await addStaff(t, owner, 'reception');
    psyA = await addStaff(t, owner, 'psychologist', 'Dra. Ana');
    psyB = await addStaff(t, owner, 'psychologist', 'Dr. Bruno');
    otherClinic = await signUpOwner(t, 'Outra');

    const types = (await as(t, owner).get('/api/session-types')).body;
    individual = types.find((x: { name: string }) => x.name === 'Individual').id;
    room1 = (await as(t, owner).post('/api/rooms', { name: 'Sala 1' })).body.id;
    room2 = (await as(t, owner).post('/api/rooms', { name: 'Sala 2' })).body.id;

    // Both work every day 08:00-20:00; Dr. Bruno is away on Tuesday.
    const everyDay = { ranges: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '08:00', end: '20:00' })) };
    await as(t, owner).put(`/api/psychologists/${psyA.user.id}/working-hours`, everyDay).expect(200);
    await as(t, owner).put(`/api/psychologists/${psyB.user.id}/working-hours`, everyDay).expect(200);
    await as(t, owner)
      .post(`/api/psychologists/${psyB.user.id}/time-off`, { startsAt: at('2030-01-08 00:00'), endsAt: at('2030-01-09 00:00') })
      .expect(201);

    const patient = async (name: string, psychologistId: string) =>
      (await as(t, reception).post('/api/patients', { name, psychologistId, email: `${name.replace(/\W/g, '')}@example.com` })).body.id;
    patientA = await patient('Paciente A', psyA.user.id);
    patientB = await patient('Paciente B', psyB.user.id);
    manyA = await Promise.all(Array.from({ length: 20 }, (_, i) => patient(`Fila ${i}`, psyA.user.id)));
  });

  afterAll(async () => {
    await t?.app.close();
  });

  afterEach(() => t.clock.set(NOW));

  describe('booking rules', () => {
    it('books a session: the end comes from the session type, the slot holds the buffer too', async () => {
      const res = await book(reception, { patientId: patientA, startsAt: MON('08:00') }).expect(201);
      expect(res.body).toMatchObject({ status: 'scheduled', psychologistId: psyA.user.id, mode: 'online', roomId: null });
      expect(new Date(res.body.endsAt).toISOString()).toBe(new Date(MON('08:50')).toISOString());
      expect(new Date(res.body.blockedUntil).toISOString()).toBe(new Date(MON('09:00')).toISOString());
    });

    it('the buffer is respected: 08:55 clashes, 09:00 is free', async () => {
      const clash = await book(reception, { patientId: manyA[0], startsAt: MON('08:55') }).expect(409);
      expect(clash.body.message).toMatch(/intervalo entre sessões/);
      expect(clash.body.conflicts[0]).toMatchObject({ reason: 'psychologist' });
      await book(reception, { patientId: manyA[0], startsAt: MON('09:00') }).expect(201);
    });

    it('in person needs an active room; online takes none', async () => {
      await book(reception, { patientId: patientA, startsAt: MON('10:00'), mode: 'in_person' }).expect(422);
      await book(reception, { patientId: patientA, startsAt: MON('10:00'), mode: 'online', roomId: room1 }).expect(422);
      const inactive = (await as(t, owner).post('/api/rooms', { name: 'Sala Fechada' })).body.id;
      await as(t, owner).patch(`/api/rooms/${inactive}`, { active: false }).expect(200);
      await book(reception, { patientId: patientA, startsAt: MON('10:00'), mode: 'in_person', roomId: inactive }).expect(422);
    });

    it('a room can’t hold two sessions, even of different psychologists', async () => {
      await book(reception, { patientId: patientA, startsAt: MON('11:00'), mode: 'in_person', roomId: room1 }).expect(201);
      const clash = await book(reception, { patientId: patientB, startsAt: MON('11:30'), mode: 'in_person', roomId: room1 }).expect(409);
      expect(clash.body.conflicts.map((c: { reason: string }) => c.reason)).toEqual(['room']);
      await book(reception, { patientId: patientB, startsAt: MON('11:30'), mode: 'in_person', roomId: room2 }).expect(201);
    });

    it('refuses the past, outside working hours, and time off', async () => {
      await book(reception, { patientId: patientA, startsAt: at('2030-01-06 08:00') }).expect(422);
      const early = await book(reception, { patientId: patientA, startsAt: MON('07:30') }).expect(422);
      expect(early.body.message).toBe('Fora do horário de trabalho do psicólogo.');
      await book(reception, { patientId: patientA, startsAt: MON('19:30') }).expect(422); // would end 20:20
      const away = await book(reception, { patientId: patientB, startsAt: at('2030-01-08 10:00') }).expect(422);
      expect(away.body.message).toBe('O psicólogo estará ausente neste horário.');
    });

    it('a patient can’t be in two sessions at once, even with different psychologists', async () => {
      const moving = (await as(t, reception).post('/api/patients', { name: 'Em transição', psychologistId: psyA.user.id })).body.id;
      await book(reception, { patientId: moving, startsAt: MON('14:00') }).expect(201);
      await as(t, reception).patch(`/api/patients/${moving}`, { psychologistId: psyB.user.id }).expect(200);
      const clash = await book(reception, { patientId: moving, startsAt: MON('14:20') }).expect(409);
      expect(clash.body.conflicts.map((c: { reason: string }) => c.reason)).toEqual(['patient']);
    });

    it('a cancelled session frees its slot', async () => {
      const first = (await book(reception, { patientId: patientB, startsAt: MON('15:00') }).expect(201)).body;
      await as(t, reception).post(`/api/appointments/${first.id}/cancel`, { by: 'clinic' }).expect(200);
      await book(reception, { patientId: patientB, startsAt: MON('15:00') }).expect(201);
    });

    it('20 simultaneous bookings of one slot: exactly one wins', async () => {
      const results = await Promise.all(manyA.map((patientId) => book(reception, { patientId, startsAt: MON('16:00') })));
      const statuses = results.map((r) => r.status);
      // Most losers are refused by the API's pre-check (409 with `conflicts`). In every measured
      // run, 1-2 requests passed the pre-check at the same instant and were stopped by the
      // exclusion constraint itself (409 without `conflicts`): the database is the real guarantee.
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(19);
      const held = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.psychologistId, psyA.user.id), eq(appointments.startsAt, new Date(MON('16:00'))), inArray(appointments.status, ['scheduled'])));
      expect(held).toHaveLength(1);
    });

    it('the database refuses an overlap even when the API is bypassed', async () => {
      const base = {
        clinicId: owner.user.clinicId,
        psychologistId: psyB.user.id,
        patientId: patientB,
        sessionTypeId: individual,
        mode: 'online' as const,
        createdBy: owner.user.id,
      };
      await db.insert(appointments).values({ ...base, startsAt: new Date(MON('17:00')), endsAt: new Date(MON('17:50')), blockedUntil: new Date(MON('18:00')) });
      const overlap = db.insert(appointments).values({ ...base, startsAt: new Date(MON('17:55')), endsAt: new Date(MON('18:45')), blockedUntil: new Date(MON('18:55')) });
      await expect(overlap).rejects.toSatisfy((e) => pgErrorCode(e) === '23P01');
    });
  });

  describe('lifecycle', () => {
    let id: string;
    beforeEach(async () => {
      id = (await book(reception, { patientId: patientB, startsAt: at('2030-01-09 10:00') }).expect(201)).body.id;
    });
    afterEach(async () => {
      await db.delete(appointments).where(eq(appointments.id, id));
    });

    it('confirms once; completes only after the start', async () => {
      await as(t, reception).post(`/api/appointments/${id}/confirm`).expect(200);
      await as(t, reception).post(`/api/appointments/${id}/confirm`).expect(422);
      const early = await as(t, psyB).post(`/api/appointments/${id}/complete`).expect(422);
      expect(early.body.message).toMatch(/depois do início/);
      t.clock.set(at('2030-01-09 10:05'));
      const done = await as(t, psyB).post(`/api/appointments/${id}/complete`).expect(200);
      expect(done.body.status).toBe('completed');
      await as(t, reception).post(`/api/appointments/${id}/cancel`, { by: 'patient' }).expect(422);
    });

    it('marks a no-show after the start; can’t cancel a session that started', async () => {
      t.clock.set(at('2030-01-09 10:20'));
      await as(t, reception).post(`/api/appointments/${id}/cancel`, { by: 'patient' }).expect(422);
      const res = await as(t, reception).post(`/api/appointments/${id}/no-show`).expect(200);
      expect(res.body.status).toBe('no_show');
    });

    it('a patient cancelling with less than 24h notice is a late cancellation', async () => {
      t.clock.set(at('2030-01-09 08:00')); // 2h before
      const res = await as(t, reception).post(`/api/appointments/${id}/cancel`, { by: 'patient', reason: 'Imprevisto' }).expect(200);
      expect(res.body).toMatchObject({ status: 'late_cancelled', cancelledBy: 'patient', cancellationReason: 'Imprevisto' });
    });

    it('with enough notice, or when the clinic cancels, it is a regular cancellation', async () => {
      t.clock.set(at('2030-01-08 09:00')); // 25h before
      expect((await as(t, reception).post(`/api/appointments/${id}/cancel`, { by: 'patient' }).expect(200)).body.status).toBe('cancelled');
      const other = (await book(reception, { patientId: patientB, startsAt: at('2030-01-09 12:00') }).expect(201)).body.id;
      t.clock.set(at('2030-01-09 11:00')); // 1h before, clinic cancels
      expect((await as(t, reception).post(`/api/appointments/${other}/cancel`, { by: 'clinic' }).expect(200)).body.status).toBe('cancelled');
      await db.delete(appointments).where(eq(appointments.id, other));
    });

    it('rescheduling moves the session and asks for a new confirmation', async () => {
      await as(t, reception).post(`/api/appointments/${id}/confirm`).expect(200);
      // 10 minutes later overlaps its own old slot: that's fine, it isn't a conflict with itself.
      const moved = await as(t, reception).patch(`/api/appointments/${id}/schedule`, { startsAt: at('2030-01-09 10:10') }).expect(200);
      expect(moved.body).toMatchObject({ status: 'scheduled' });
      expect(new Date(moved.body.endsAt).toISOString()).toBe(new Date(at('2030-01-09 11:00')).toISOString());
    });

    it('rescheduling into someone else’s slot is a conflict', async () => {
      const other = (await book(reception, { patientId: patientB, startsAt: at('2030-01-09 14:00') }).expect(201)).body.id;
      await as(t, reception).patch(`/api/appointments/${id}/schedule`, { startsAt: at('2030-01-09 14:30') }).expect(409);
      await db.delete(appointments).where(eq(appointments.id, other));
    });

    it('confirm and cancel at the same time: one wins, the other is told', async () => {
      const [confirm, cancel] = await Promise.all([
        as(t, reception).post(`/api/appointments/${id}/confirm`),
        as(t, owner).post(`/api/appointments/${id}/cancel`, { by: 'clinic' }),
      ]);
      const statuses = [confirm.status, cancel.status].sort((a, b) => a - b);
      // Both may succeed in sequence (confirm, then cancel), or one loses the race.
      expect([[200, 200], [200, 409], [200, 422]]).toContainEqual(statuses);
      const [row] = await db.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, id));
      expect(['confirmed', 'cancelled']).toContain(row.status);
    });
  });

  describe('who sees and does what', () => {
    let ofA: string;
    beforeAll(async () => {
      ofA = (await book(reception, { patientId: patientA, startsAt: at('2030-01-10 09:00') }).expect(201)).body.id;
    });

    it('a psychologist books only for their own patients', async () => {
      await book(psyB, { patientId: patientA, startsAt: at('2030-01-10 15:00') }).expect(403);
      await book(psyA, { patientId: patientA, startsAt: at('2030-01-10 15:00') }).expect(201);
    });

    it('a colleague’s session is a 404 to act on, and opaque in the calendar', async () => {
      await as(t, psyB).get(`/api/appointments/${ofA}`).expect(404);
      await as(t, psyB).post(`/api/appointments/${ofA}/cancel`, { by: 'clinic' }).expect(404);
      const week = `/api/appointments?from=${encodeURIComponent(at('2030-01-10 00:00'))}&to=${encodeURIComponent(at('2030-01-11 00:00'))}`;
      const forB = (await as(t, psyB).get(week).expect(200)).body.find((a: { id: string }) => a.id === ofA);
      expect(forB).toMatchObject({ restricted: true, patientId: null, patientName: null, sessionTypeName: null, psychologistName: 'Dra. Ana' });
      const forDesk = (await as(t, reception).get(week).expect(200)).body.find((a: { id: string }) => a.id === ofA);
      expect(forDesk).toMatchObject({ restricted: false, patientName: 'Paciente A', sessionTypeName: 'Individual' });
    });

    it('another clinic sees nothing', async () => {
      await as(t, otherClinic).get(`/api/appointments/${ofA}`).expect(404);
      const window = `/api/appointments?from=${encodeURIComponent(at('2030-01-01 00:00'))}&to=${encodeURIComponent(at('2030-02-01 00:00'))}`;
      expect((await as(t, otherClinic).get(window).expect(200)).body).toEqual([]);
    });

    it('calendar queries are bounded', async () => {
      await as(t, reception).get(`/api/appointments?from=${encodeURIComponent(at('2030-01-01 00:00'))}&to=${encodeURIComponent(at('2030-06-01 00:00'))}`).expect(400);
    });
  });
});
