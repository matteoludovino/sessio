import { getDrizzleToken } from '@nestjs/drizzle';
import request from 'supertest';
import { workingHours } from '../src/availability/availability.schema.js';
import type { Database } from '../src/db/db.module.js';
import { pgErrorCode } from '../src/db/errors.js';
import { patients } from '../src/patients/patients.schema.js';
import { createTestApp, type TestApp } from './support/app.js';
import { addStaff, type SignedIn, signUpOwner } from './support/auth.js';

describe('registers', () => {
  let t: TestApp;
  let db: Database;
  let owner: SignedIn;
  let reception: SignedIn;
  let psyA: SignedIn;
  let psyB: SignedIn;
  let otherClinic: SignedIn;

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(getDrizzleToken());
    owner = await signUpOwner(t, 'Clínica Cadastros');
    reception = await addStaff(t, owner, 'reception', 'Recepção');
    psyA = await addStaff(t, owner, 'psychologist', 'Dra. Ana');
    psyB = await addStaff(t, owner, 'psychologist', 'Dr. Bruno');
    otherClinic = await signUpOwner(t, 'Outra Clínica');
  });

  afterAll(async () => {
    await t?.app.close();
  });

  const as = (who: SignedIn) => ({
    get: (url: string) => request(t.http).get(url).set('Cookie', who.cookie),
    post: (url: string, body: object) => request(t.http).post(url).set('Cookie', who.cookie).send(body),
    patch: (url: string, body: object) => request(t.http).patch(url).set('Cookie', who.cookie).send(body),
    put: (url: string, body: object) => request(t.http).put(url).set('Cookie', who.cookie).send(body),
    delete: (url: string) => request(t.http).delete(url).set('Cookie', who.cookie),
  });

  describe('clinic settings', () => {
    it('everyone reads them; only the owner changes them, within bounds', async () => {
      const read = await as(psyA).get('/api/clinic').expect(200);
      expect(read.body).toMatchObject({ name: 'Clínica Cadastros', timezone: 'America/Sao_Paulo', lateCancelHours: 24, bufferMinutes: 10, reminderLeadHours: 48 });
      await as(reception).patch('/api/clinic', { bufferMinutes: 15 }).expect(403);
      await as(owner).patch('/api/clinic', { timezone: 'Mars/Olympus' }).expect(400);
      await as(owner).patch('/api/clinic', { bufferMinutes: 90 }).expect(400);
      const updated = await as(owner).patch('/api/clinic', { bufferMinutes: 15, reminderLeadHours: 72 }).expect(200);
      expect(updated.body).toMatchObject({ bufferMinutes: 15, reminderLeadHours: 72 });
      await as(owner).patch('/api/clinic', { bufferMinutes: 10, reminderLeadHours: 48 }).expect(200);
    });
  });

  describe('session types', () => {
    it('a new clinic starts with the default session types', async () => {
      const res = await as(owner).get('/api/session-types').expect(200);
      expect(res.body.map((s: { name: string; durationMinutes: number }) => [s.name, s.durationMinutes])).toEqual([
        ['Avaliação', 60],
        ['Casal', 80],
        ['Individual', 50],
      ]);
    });

    it('the owner manages them; durations stay between 15 and 240 minutes', async () => {
      await as(owner).post('/api/session-types', { name: 'Orientação', durationMinutes: 10 }).expect(400);
      await as(owner).post('/api/session-types', { name: 'Orientação', durationMinutes: 300 }).expect(400);
      await as(owner).post('/api/session-types', { name: 'Orientação', durationMinutes: 45 }).expect(201);
      await as(owner).post('/api/session-types', { name: 'orientação', durationMinutes: 45 }).expect(409);
      await as(reception).post('/api/session-types', { name: 'Outra', durationMinutes: 45 }).expect(403);
    });
  });

  describe('rooms', () => {
    it('the owner creates rooms, unique by name regardless of case', async () => {
      const res = await as(owner).post('/api/rooms', { name: 'Sala Azul' }).expect(201);
      expect(res.body).toMatchObject({ name: 'Sala Azul', active: true });
      const dup = await as(owner).post('/api/rooms', { name: 'sala azul' }).expect(409);
      expect(dup.body.message).toBe('Já existe uma sala com este nome.');
    });

    it('the same name is fine in another clinic', async () => {
      await as(otherClinic).post('/api/rooms', { name: 'Sala Azul' }).expect(201);
    });

    it('everyone reads rooms; only the owner changes them', async () => {
      await as(psyA).get('/api/rooms').expect(200);
      await as(reception).post('/api/rooms', { name: 'Sala X' }).expect(403);
      await as(psyA).post('/api/rooms', { name: 'Sala X' }).expect(403);
    });

    it('deactivated rooms leave the default listing', async () => {
      const room = (await as(owner).post('/api/rooms', { name: 'Sala Verde' }).expect(201)).body;
      await as(owner).patch(`/api/rooms/${room.id}`, { active: false }).expect(200);
      const active = await as(owner).get('/api/rooms').expect(200);
      expect(active.body.map((r: { id: string }) => r.id)).not.toContain(room.id);
      const all = await as(owner).get('/api/rooms?includeInactive=true').expect(200);
      expect(all.body.map((r: { id: string }) => r.id)).toContain(room.id);
    });

    it('another clinic’s room is a 404', async () => {
      const room = (await as(owner).post('/api/rooms', { name: 'Sala Lilás' }).expect(201)).body;
      await as(otherClinic).patch(`/api/rooms/${room.id}`, { name: 'Hackeada' }).expect(404);
    });
  });

  describe('patients', () => {
    it('the front desk registers a patient for a psychologist', async () => {
      const res = await as(reception)
        .post('/api/patients', { name: 'Carla Souza', email: ' Carla@Example.com ', psychologistId: psyA.user.id })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Carla Souza', email: 'carla@example.com', psychologistId: psyA.user.id });
    });

    it('the front desk must say who the psychologist is, and it must be one', async () => {
      await as(reception).post('/api/patients', { name: 'Sem Psicólogo' }).expect(422);
      await as(reception).post('/api/patients', { name: 'X', psychologistId: reception.user.id }).expect(422);
      // A psychologist of another clinic: the composite foreign key would refuse it too.
      const foreign = await addStaff(t, otherClinic, 'psychologist');
      await as(reception).post('/api/patients', { name: 'X', psychologistId: foreign.user.id }).expect(422);
    });

    it('the database itself refuses a patient pointing at another clinic’s psychologist', async () => {
      const foreign = await addStaff(t, otherClinic, 'psychologist');
      const insert = db.insert(patients).values({ clinicId: owner.user.clinicId, psychologistId: foreign.user.id, name: 'Bypass' });
      await expect(insert).rejects.toSatisfy((e) => pgErrorCode(e) === '23503');
    });

    it('a psychologist registers patients for themselves and can’t assign them to someone else', async () => {
      const own = await as(psyB).post('/api/patients', { name: 'Paciente do Bruno' }).expect(201);
      expect(own.body.psychologistId).toBe(psyB.user.id);
      await as(psyB).post('/api/patients', { name: 'Para a Ana', psychologistId: psyA.user.id }).expect(403);
    });

    it('a psychologist only sees their own patients; others are 404', async () => {
      const ofA = (await as(reception).post('/api/patients', { name: 'Paciente da Ana', psychologistId: psyA.user.id })).body;
      const listB = await as(psyB).get('/api/patients').expect(200);
      expect(listB.body.every((p: { psychologistId: string }) => p.psychologistId === psyB.user.id)).toBe(true);
      await as(psyB).get(`/api/patients/${ofA.id}`).expect(404);
      await as(psyB).patch(`/api/patients/${ofA.id}`, { phone: '999' }).expect(404);
      await as(psyA).patch(`/api/patients/${ofA.id}`, { phone: '(21) 99999-0000' }).expect(200);
    });

    it('only the front desk archives or reassigns', async () => {
      const p = (await as(reception).post('/api/patients', { name: 'Arquivável', psychologistId: psyA.user.id })).body;
      await as(psyA).patch(`/api/patients/${p.id}`, { active: false }).expect(403);
      await as(psyA).patch(`/api/patients/${p.id}`, { psychologistId: psyB.user.id }).expect(403);
      await as(reception).patch(`/api/patients/${p.id}`, { active: false }).expect(200);
      const list = await as(reception).get('/api/patients').expect(200);
      expect(list.body.map((x: { id: string }) => x.id)).not.toContain(p.id);
      const all = await as(reception).get('/api/patients?includeArchived=true').expect(200);
      expect(all.body.map((x: { id: string }) => x.id)).toContain(p.id);
    });

    it('search matches name or email, and treats % and _ literally', async () => {
      await as(reception).post('/api/patients', { name: 'Débora 100% Lima', psychologistId: psyA.user.id }).expect(201);
      await as(reception).post('/api/patients', { name: 'Débora Lima', psychologistId: psyA.user.id }).expect(201);
      const res = await as(reception).get(`/api/patients?q=${encodeURIComponent('100%')}`).expect(200);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Débora 100% Lima']);
      const byEmail = await as(reception).get('/api/patients?q=carla@').expect(200);
      expect(byEmail.body.map((p: { name: string }) => p.name)).toContain('Carla Souza');
    });

    it('another clinic’s patient is a 404', async () => {
      const p = (await as(reception).post('/api/patients', { name: 'Privada', psychologistId: psyA.user.id })).body;
      await as(otherClinic).get(`/api/patients/${p.id}`).expect(404);
    });
  });

  describe('working hours and time off', () => {
    const week = {
      ranges: [
        { weekday: 1, start: '08:00', end: '12:00' },
        { weekday: 1, start: '13:00', end: '18:00' },
        { weekday: 3, start: '09:00', end: '17:00' },
      ],
    };

    it('replaces the weekly schedule and reads it back', async () => {
      const res = await as(reception).put(`/api/psychologists/${psyA.user.id}/working-hours`, week).expect(200);
      expect(res.body).toEqual(week.ranges);
      await as(psyB).get(`/api/psychologists/${psyA.user.id}/working-hours`).expect(200, week.ranges);
    });

    it('rejects overlapping or malformed ranges', async () => {
      const overlap = { ranges: [{ weekday: 2, start: '08:00', end: '12:00' }, { weekday: 2, start: '11:00', end: '14:00' }] };
      await as(owner).put(`/api/psychologists/${psyA.user.id}/working-hours`, overlap).expect(400);
      await as(owner).put(`/api/psychologists/${psyA.user.id}/working-hours`, { ranges: [{ weekday: 2, start: '8h', end: '12:00' }] }).expect(400);
      await as(owner).put(`/api/psychologists/${psyA.user.id}/working-hours`, { ranges: [{ weekday: 7, start: '08:00', end: '12:00' }] }).expect(400);
      await as(owner).put(`/api/psychologists/${psyA.user.id}/working-hours`, { ranges: [{ weekday: 2, start: '12:00', end: '08:00' }] }).expect(400);
    });

    it('back-to-back ranges are fine ([start, end) does not overlap)', async () => {
      const adjacent = { ranges: [{ weekday: 5, start: '08:00', end: '12:00' }, { weekday: 5, start: '12:00', end: '24:00' }] };
      await as(psyB).put(`/api/psychologists/${psyB.user.id}/working-hours`, adjacent).expect(200);
    });

    it('the database refuses an overlap even when the API is bypassed', async () => {
      const row = { clinicId: owner.user.clinicId, psychologistId: psyB.user.id, weekday: 4 };
      await db.insert(workingHours).values({ ...row, startMinute: 480, endMinute: 720 });
      const overlapping = db.insert(workingHours).values({ ...row, startMinute: 600, endMinute: 800 });
      await expect(overlapping).rejects.toSatisfy((e) => pgErrorCode(e) === '23P01');
    });

    it('concurrent replacements all succeed and leave one complete schedule (no deadlock)', async () => {
      const schedules = Array.from({ length: 10 }, (_, i) => ({
        ranges: [{ weekday: 6, start: `0${i % 10}:00`.slice(-5), end: '20:00' }],
      }));
      const results = await Promise.all(
        schedules.map((s) => as(owner).put(`/api/psychologists/${psyA.user.id}/working-hours`, s)),
      );
      // Serialized per psychologist: every replacement succeeds in turn, none deadlocks.
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      const final = await as(owner).get(`/api/psychologists/${psyA.user.id}/working-hours`).expect(200);
      expect(schedules.map((s) => JSON.stringify(s.ranges))).toContain(JSON.stringify(final.body));
    });

    it('a psychologist edits their own schedule only; the front desk edits anyone’s', async () => {
      await as(psyB).put(`/api/psychologists/${psyA.user.id}/working-hours`, week).expect(403);
      await as(psyA).put(`/api/psychologists/${psyA.user.id}/working-hours`, week).expect(200);
    });

    it('time off: add, overlap refused by the database, list by period, remove', async () => {
      const base = `/api/psychologists/${psyA.user.id}/time-off`;
      const vacation = { startsAt: '2027-01-05T00:00:00-03:00', endsAt: '2027-01-20T00:00:00-03:00', reason: 'Férias' };
      const created = (await as(reception).post(base, vacation).expect(201)).body;
      const clash = await as(reception).post(base, { startsAt: '2027-01-19T00:00:00-03:00', endsAt: '2027-01-25T00:00:00-03:00' }).expect(409);
      expect(clash.body.message).toBe('Já existe uma ausência cadastrada neste período.');
      await as(reception).post(base, { startsAt: '2027-02-01T10:00:00-03:00', endsAt: '2027-02-01T09:00:00-03:00' }).expect(400);

      const jan = await as(psyB).get(`${base}?from=2027-01-01T00:00:00-03:00&to=2027-01-31T00:00:00-03:00`).expect(200);
      expect(jan.body.map((x: { id: string }) => x.id)).toEqual([created.id]);
      const feb = await as(psyB).get(`${base}?from=2027-02-01T00:00:00-03:00&to=2027-02-28T00:00:00-03:00`).expect(200);
      expect(feb.body).toEqual([]);

      await as(otherClinic).delete(`${base}/${created.id}`).expect(404);
      await as(reception).delete(`${base}/${created.id}`).expect(204);
      await as(reception).delete(`${base}/${created.id}`).expect(404);
    });

    it('unknown or non-psychologist ids are 404', async () => {
      await as(owner).get(`/api/psychologists/${reception.user.id}/working-hours`).expect(404);
      await as(otherClinic).get(`/api/psychologists/${psyA.user.id}/working-hours`).expect(404);
    });

    it('lists the clinic’s active psychologists', async () => {
      const res = await as(reception).get('/api/psychologists').expect(200);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Dr. Bruno', 'Dra. Ana']);
    });
  });
});
