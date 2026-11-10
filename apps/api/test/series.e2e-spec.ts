import { getDrizzleToken } from '@nestjs/drizzle';
import { asc, eq } from 'drizzle-orm';
import request from 'supertest';
import { appointments } from '../src/appointments/appointments.schema.js';
import { appointmentSeries } from '../src/appointments/series.schema.js';
import type { Database } from '../src/db/db.module.js';
import { createTestApp, type TestApp } from './support/app.js';
import { addStaff, type SignedIn, signUpOwner } from './support/auth.js';
import { as, at } from './support/client.js';

// Fixed "now": Sunday 2030-01-06 09:00 in São Paulo → the 12-week horizon is 2030-03-31.
const NOW = at('2030-01-06 09:00');
const JOBS = { Authorization: 'Bearer dev-jobs-secret-change-me' };

interface Occurrence {
  id: string;
  occurrenceDate: string;
  startsAt: string;
  status: string;
  seriesId: string;
}

describe('recurring series', () => {
  let t: TestApp;
  let db: Database;
  let owner: SignedIn;
  let reception: SignedIn;
  let psyA: SignedIn;
  let psyB: SignedIn;
  let otherClinic: SignedIn;
  let individual: string;
  let n = 0;

  /** A fresh patient of Dra. Ana, so tests don't collide on the patient's own sessions. */
  const newPatient = async () =>
    (await as(t, reception).post('/api/patients', { name: `Paciente ${++n}`, psychologistId: psyA.user.id })).body.id as string;

  const createSeries = (who: SignedIn, body: Record<string, unknown>) =>
    as(t, who).post('/api/appointment-series', { sessionTypeId: individual, mode: 'online', ...body });

  const occurrencesOf = (seriesId: string) =>
    db.select().from(appointments).where(eq(appointments.seriesId, seriesId)).orderBy(asc(appointments.occurrenceDate));

  beforeAll(async () => {
    t = await createTestApp();
    t.clock.set(NOW);
    db = t.app.get(getDrizzleToken());
    owner = await signUpOwner(t, 'Clínica Séries');
    reception = await addStaff(t, owner, 'reception');
    psyA = await addStaff(t, owner, 'psychologist', 'Dra. Ana');
    psyB = await addStaff(t, owner, 'psychologist', 'Dr. Bruno');
    otherClinic = await signUpOwner(t, 'Outra');
    individual = (await as(t, owner).get('/api/session-types')).body.find((x: { name: string }) => x.name === 'Individual').id;
    const everyDay = { ranges: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '08:00', end: '20:00' })) };
    await as(t, owner).put(`/api/psychologists/${psyA.user.id}/working-hours`, everyDay).expect(200);
  });

  afterAll(async () => {
    await t?.app.close();
  });

  afterEach(() => t.clock.set(NOW));

  it('a weekly open-ended series materializes every Monday up to the 12-week horizon', async () => {
    const res = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-07 08:00') }).expect(201);
    expect(res.body.series).toMatchObject({ anchorDate: '2030-01-07', startMinute: 480, intervalWeeks: 1, horizonDate: '2030-03-31' });
    const dates = res.body.occurrences.map((o: Occurrence) => o.occurrenceDate);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe('2030-01-07');
    expect(dates.at(-1)).toBe('2030-03-25');
    // Every occurrence at 08:00 local (11:00Z) and an ordinary scheduled appointment.
    expect(res.body.occurrences.every((o: Occurrence) => new Date(o.startsAt).toISOString().endsWith('T11:00:00.000Z'))).toBe(true);
    expect(res.body.occurrences.every((o: Occurrence) => o.status === 'scheduled')).toBe(true);
  });

  it('biweekly, by count or until a date', async () => {
    const biweekly = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-08 09:00'), intervalWeeks: 2 }).expect(201);
    expect(biweekly.body.occurrences.map((o: Occurrence) => o.occurrenceDate).slice(0, 3)).toEqual(['2030-01-08', '2030-01-22', '2030-02-05']);
    const four = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-08 10:00'), maxOccurrences: 4 }).expect(201);
    expect(four.body.occurrences).toHaveLength(4);
    const until = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-08 11:00'), untilDate: '2030-01-22' }).expect(201);
    expect(until.body.occurrences.map((o: Occurrence) => o.occurrenceDate)).toEqual(['2030-01-08', '2030-01-15', '2030-01-22']);
    await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-08 12:00'), untilDate: '2030-01-01' }).expect(422);
  });

  it('refuses the whole series, listing every conflicting date with its reason', async () => {
    const patientId = await newPatient();
    // In the way: another session on the 3rd Wednesday, and time off on the 5th.
    await as(t, reception)
      .post('/api/appointments', { patientId: await newPatient(), sessionTypeId: individual, mode: 'online', startsAt: at('2030-01-23 14:30') })
      .expect(201);
    await as(t, reception).post(`/api/psychologists/${psyA.user.id}/time-off`, { startsAt: at('2030-02-06 00:00'), endsAt: at('2030-02-07 00:00') }).expect(201);

    const res = await createSeries(reception, { patientId, startsAt: at('2030-01-09 14:00') }).expect(409);
    expect(res.body.message).toBe('2 data(s) da série têm conflito.');
    expect(res.body.conflicts.map((c: { occurrenceDate: string; reason: string }) => [c.occurrenceDate, c.reason])).toEqual([
      ['2030-01-23', 'psychologist'],
      ['2030-02-06', 'time_off'],
    ]);
    const created = await db.select().from(appointmentSeries).where(eq(appointmentSeries.patientId, patientId));
    expect(created).toHaveLength(0); // all or nothing

    const skipping = await createSeries(reception, { patientId, startsAt: at('2030-01-09 14:00'), skipConflicts: true }).expect(201);
    expect(skipping.body.skipped.map((s: { occurrenceDate: string }) => s.occurrenceDate)).toEqual(['2030-01-23', '2030-02-06']);
    expect(skipping.body.occurrences.map((o: Occurrence) => o.occurrenceDate)).not.toContain('2030-01-23');
    expect(skipping.body.occurrences).toHaveLength(10);
  });

  it('occurrences are ordinary appointments: rescheduling one leaves the others alone', async () => {
    const res = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-10 08:00'), maxOccurrences: 3 }).expect(201);
    const second: Occurrence = res.body.occurrences[1];
    await as(t, reception).post(`/api/appointments/${second.id}/confirm`).expect(200);
    const moved = await as(t, reception).patch(`/api/appointments/${second.id}/schedule`, { startsAt: at('2030-01-18 15:00') }).expect(200);
    expect(moved.body).toMatchObject({ occurrenceDate: '2030-01-17', status: 'scheduled' }); // keeps its planned date
    const rows = await occurrencesOf(res.body.series.id);
    expect(rows.map((r) => new Date(r.startsAt).toISOString())).toEqual([
      new Date(at('2030-01-10 08:00')).toISOString(),
      new Date(at('2030-01-18 15:00')).toISOString(),
      new Date(at('2030-01-24 08:00')).toISOString(),
    ]);
  });

  it('"this and following" splits the series: history stays, the rest moves', async () => {
    const res = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-07 10:00') }).expect(201);
    const fourth: Occurrence = res.body.occurrences[3]; // 2030-01-28
    const moved = await as(t, reception)
      // Thursdays: Wednesday 2030-02-06 is Dra. Ana's time off (set by an earlier test).
      .patch(`/api/appointments/${fourth.id}/schedule`, { scope: 'following', startsAt: at('2030-01-31 16:00') })
      .expect(200);
    expect(moved.body.series).toMatchObject({ anchorDate: '2030-01-31', startMinute: 960 });
    expect(moved.body.occurrences.map((o: Occurrence) => o.occurrenceDate).slice(0, 2)).toEqual(['2030-01-31', '2030-02-07']);

    const old = await occurrencesOf(res.body.series.id);
    expect(old.map((o) => o.occurrenceDate)).toEqual(['2030-01-07', '2030-01-14', '2030-01-21']);
    const [oldSeries] = await db.select().from(appointmentSeries).where(eq(appointmentSeries.id, res.body.series.id));
    expect(oldSeries.untilDate).toBe('2030-01-27');
  });

  it('a "following" change that would conflict changes nothing', async () => {
    const res = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-11 09:00'), maxOccurrences: 4 }).expect(201);
    await as(t, reception)
      .post('/api/appointments', { patientId: await newPatient(), sessionTypeId: individual, mode: 'online', startsAt: at('2030-01-25 17:00') })
      .expect(201);
    const second: Occurrence = res.body.occurrences[1];
    const clash = await as(t, reception)
      .patch(`/api/appointments/${second.id}/schedule`, { scope: 'following', startsAt: at('2030-01-18 17:00') })
      .expect(409);
    expect(clash.body.conflicts.map((c: { occurrenceDate: string }) => c.occurrenceDate)).toEqual(['2030-01-25']);
    expect(await occurrencesOf(res.body.series.id)).toHaveLength(4);
  });

  it('cancelling "this and following" ends the series; the deadline applies to each session', async () => {
    const res = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-07 12:00'), maxOccurrences: 5 }).expect(201);
    const third: Occurrence = res.body.occurrences[2]; // 2030-01-21 12:00
    t.clock.set(at('2030-01-21 02:00')); // 10h before the third
    const cancel = await as(t, reception)
      .post(`/api/appointments/${third.id}/cancel`, { scope: 'following', by: 'patient' })
      .expect(200);
    expect(cancel.body).toEqual({ cancelled: 3 });
    const rows = await occurrencesOf(res.body.series.id);
    expect(rows.map((r) => r.status)).toEqual(['scheduled', 'scheduled', 'late_cancelled', 'cancelled', 'cancelled']);
  });

  it('a non-recurring session has no "following"', async () => {
    const single = await as(t, reception)
      .post('/api/appointments', { patientId: await newPatient(), sessionTypeId: individual, mode: 'online', startsAt: at('2030-01-12 08:00') })
      .expect(201);
    await as(t, reception).post(`/api/appointments/${single.body.id}/cancel`, { scope: 'following', by: 'clinic' }).expect(422);
  });

  describe('horizon job', () => {
    it('requires the jobs secret', async () => {
      await request(t.http).post('/api/internal/jobs/run').expect(401);
      await request(t.http).post('/api/internal/jobs/run').set('Authorization', 'Bearer wrong').expect(401);
    });

    it('extends open series as weeks pass, idempotently, even with concurrent runs', async () => {
      const res = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-07 18:00') }).expect(201);
      expect(await occurrencesOf(res.body.series.id)).toHaveLength(12);

      t.clock.set(at('2030-01-20 09:00')); // two weeks later: horizon 2030-04-14
      const runs = await Promise.all([1, 2, 3].map(() => request(t.http).post('/api/internal/jobs/run').set(JOBS)));
      expect(runs.every((r) => r.status === 200)).toBe(true);
      const rows = await occurrencesOf(res.body.series.id);
      expect(rows.map((r) => r.occurrenceDate).slice(-2)).toEqual(['2030-04-01', '2030-04-08']);
      expect(rows).toHaveLength(14); // no duplicates
      await request(t.http).post('/api/internal/jobs/run').set(JOBS).expect(200);
      expect(await occurrencesOf(res.body.series.id)).toHaveLength(14);
    });

    it('skips a date that became busy beyond the horizon, and never regenerates moved ones', async () => {
      // Thursdays, away from Wednesday 2030-02-06's time off.
      const res = await createSeries(reception, { patientId: await newPatient(), startsAt: at('2030-01-10 18:00') }).expect(201);
      // Someone books the series' future slot (2030-04-04) before the job reaches it.
      t.clock.set(at('2030-01-08 09:00'));
      await as(t, reception)
        .post('/api/appointments', { patientId: await newPatient(), sessionTypeId: individual, mode: 'online', startsAt: at('2030-04-04 18:00') })
        .expect(201);
      t.clock.set(at('2030-01-20 09:00'));
      await request(t.http).post('/api/internal/jobs/run').set(JOBS).expect(200);
      const dates = (await occurrencesOf(res.body.series.id)).map((r) => r.occurrenceDate);
      expect(dates).toContain('2030-04-11');
      expect(dates).not.toContain('2030-04-04');
    });
  });

  describe('permissions', () => {
    it('a psychologist only creates series for their own patients, and sees only their own', async () => {
      const patientId = await newPatient();
      await createSeries(psyB, { patientId, startsAt: at('2030-01-13 08:00') }).expect(403);
      const mine = await createSeries(psyA, { patientId, startsAt: at('2030-01-13 08:00'), maxOccurrences: 2 }).expect(201);
      await as(t, psyB).get(`/api/appointment-series/${mine.body.series.id}`).expect(404);
      await as(t, otherClinic).get(`/api/appointment-series/${mine.body.series.id}`).expect(404);
      const read = await as(t, reception).get(`/api/appointment-series/${mine.body.series.id}`).expect(200);
      expect(read.body.occurrences).toHaveLength(2);
    });
  });
});
