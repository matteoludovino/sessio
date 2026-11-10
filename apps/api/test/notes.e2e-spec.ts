import { getDrizzleToken } from '@nestjs/drizzle';
import { and, eq } from 'drizzle-orm';
import { auditEvents } from '../src/audit/audit.schema.js';
import type { Database } from '../src/db/db.module.js';
import { clinicalNotes } from '../src/notes/notes.schema.js';
import { createTestApp, type TestApp } from './support/app.js';
import { addStaff, type SignedIn, signUpOwner } from './support/auth.js';
import { as } from './support/client.js';

const SECRET = 'Relata crises de ansiedade no trabalho; plano: técnicas de respiração.';

describe('clinical notes', () => {
  let t: TestApp;
  let db: Database;
  let owner: SignedIn;
  let reception: SignedIn;
  let psyA: SignedIn;
  let psyB: SignedIn;
  let otherClinic: SignedIn;
  let patientOfA: string;

  const auditFor = (actorId: string, action: string) =>
    db.select().from(auditEvents).where(and(eq(auditEvents.actorId, actorId), eq(auditEvents.action, action)));

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(getDrizzleToken());
    owner = await signUpOwner(t, 'Clínica Prontuário');
    reception = await addStaff(t, owner, 'reception');
    psyA = await addStaff(t, owner, 'psychologist', 'Dra. Ana');
    psyB = await addStaff(t, owner, 'psychologist', 'Dr. Bruno');
    otherClinic = await signUpOwner(t, 'Outra');
    patientOfA = (await as(t, reception).post('/api/patients', { name: 'Paciente Sigilosa', psychologistId: psyA.user.id })).body.id;
  });

  afterAll(async () => {
    await t?.app.close();
  });

  const write = (who: SignedIn, content = SECRET, extra: object = {}) =>
    as(t, who).post(`/api/patients/${patientOfA}/notes`, { content, ...extra });

  it('the psychologist writes and reads their notes', async () => {
    const created = (await write(psyA).expect(201)).body;
    expect(created).toMatchObject({ content: SECRET, authorId: psyA.user.id, patientId: patientOfA });
    const list = await as(t, psyA).get(`/api/patients/${patientOfA}/notes`).expect(200);
    expect(list.body.map((n: { content: string }) => n.content)).toContain(SECRET);
    await as(t, psyA).get(`/api/notes/${created.id}`).expect(200);
  });

  it('the database never holds the content in clear', async () => {
    const created = (await write(psyA, 'Conteúdo exclusivo XYZ-123').expect(201)).body;
    const [row] = await db.select().from(clinicalNotes).where(eq(clinicalNotes.id, created.id));
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('XYZ-123');
    expect(Buffer.from(row.ciphertext, 'base64').toString('utf8')).not.toContain('XYZ-123');
    expect(row.keyVersion).toBe(1);
  });

  it('owner and reception can’t read or write the record (403), and the attempts are audited', async () => {
    const note = (await write(psyA).expect(201)).body;
    for (const who of [owner, reception]) {
      const res = await as(t, who).get(`/api/patients/${patientOfA}/notes`).expect(403);
      expect(res.body.message).toBe('O prontuário é restrito ao psicólogo que o escreveu.');
      await as(t, who).get(`/api/notes/${note.id}`).expect(403);
      await as(t, who).post(`/api/patients/${patientOfA}/notes`, { content: 'tentativa' }).expect(403);
    }
    const denied = await auditFor(owner.user.id, 'note.list');
    expect(denied.map((e) => e.outcome)).toContain('denied');
  });

  it('a colleague can’t see that the notes exist (404), and that is audited too', async () => {
    const note = (await write(psyA).expect(201)).body;
    await as(t, psyB).get(`/api/notes/${note.id}`).expect(404);
    await as(t, psyB).get(`/api/patients/${patientOfA}/notes`).expect(404);
    await as(t, psyB).post(`/api/patients/${patientOfA}/notes`, { content: 'não é meu paciente' }).expect(404);
    expect((await auditFor(psyB.user.id, 'note.read')).every((e) => e.outcome === 'denied')).toBe(true);
  });

  it('after a patient changes psychologist, old notes stay with their author', async () => {
    const patient = (await as(t, reception).post('/api/patients', { name: 'Em transição', psychologistId: psyA.user.id })).body.id;
    await as(t, psyA).post(`/api/patients/${patient}/notes`, { content: 'nota da Ana' }).expect(201);
    await as(t, reception).patch(`/api/patients/${patient}`, { psychologistId: psyB.user.id }).expect(200);

    // Ana keeps reading what she wrote, but can't add to a patient no longer hers.
    const ana = await as(t, psyA).get(`/api/patients/${patient}/notes`).expect(200);
    expect(ana.body.map((n: { content: string }) => n.content)).toEqual(['nota da Ana']);
    await as(t, psyA).post(`/api/patients/${patient}/notes`, { content: 'mais uma' }).expect(404);
    // Bruno starts a record of his own and never sees Ana's.
    await as(t, psyB).post(`/api/patients/${patient}/notes`, { content: 'nota do Bruno' }).expect(201);
    const bruno = await as(t, psyB).get(`/api/patients/${patient}/notes`).expect(200);
    expect(bruno.body.map((n: { content: string }) => n.content)).toEqual(['nota do Bruno']);
  });

  it('append-only: corrections are addenda that point at the original', async () => {
    const original = (await write(psyA, 'Data do próximo retorno: 12/03').expect(201)).body;
    const addendum = (await write(psyA, 'Correção: retorno em 19/03', { amendsNoteId: original.id }).expect(201)).body;
    expect(addendum.amendsNoteId).toBe(original.id);
    // There is no way to rewrite or delete a note through the API.
    await as(t, psyA).patch(`/api/notes/${original.id}`, { content: 'reescrita' }).expect(404);
    await as(t, psyA).delete(`/api/notes/${original.id}`).expect(404);
    await write(psyA, 'x', { amendsNoteId: '00000000-0000-4000-8000-000000000000' }).expect(422);
  });

  it('a note can be tied to one of the patient’s sessions with that psychologist only', async () => {
    await write(psyA, 'x', { appointmentId: '00000000-0000-4000-8000-000000000000' }).expect(422);
  });

  it('a tampered ciphertext is never served', async () => {
    const note = (await write(psyA, 'para adulterar').expect(201)).body;
    const [row] = await db.select().from(clinicalNotes).where(eq(clinicalNotes.id, note.id));
    const bytes = Buffer.from(row.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    await db.update(clinicalNotes).set({ ciphertext: bytes.toString('base64') }).where(eq(clinicalNotes.id, note.id));
    const res = await as(t, psyA).get(`/api/notes/${note.id}`).expect(500);
    expect(res.body.message).toBe('Falha de integridade no prontuário. Contate o suporte.');
  });

  it('a ciphertext copied onto another note fails: it is bound to its row', async () => {
    const source = (await write(psyA, 'conteúdo da nota de origem').expect(201)).body;
    const target = (await write(psyA, 'nota alvo').expect(201)).body;
    const [s] = await db.select().from(clinicalNotes).where(eq(clinicalNotes.id, source.id));
    await db.update(clinicalNotes).set({ ciphertext: s.ciphertext, iv: s.iv, tag: s.tag }).where(eq(clinicalNotes.id, target.id));
    await as(t, psyA).get(`/api/notes/${target.id}`).expect(500);
  });

  it('every access is in the audit log, which only the owner reads, without content', async () => {
    const note = (await write(psyA).expect(201)).body;
    await as(t, psyA).get(`/api/notes/${note.id}`).expect(200);
    const log = await as(t, owner).get(`/api/audit-events?patientId=${patientOfA}`).expect(200);
    const read = log.body.find((e: { action: string; resourceId: string }) => e.action === 'note.read' && e.resourceId === note.id);
    expect(read).toMatchObject({ outcome: 'allowed', actorName: 'Dra. Ana', actorRole: 'psychologist' });
    expect(JSON.stringify(log.body)).not.toContain('respiração'); // never the content
    await as(t, psyA).get('/api/audit-events').expect(403);
    await as(t, reception).get('/api/audit-events').expect(403);
  });

  it('another clinic sees nothing', async () => {
    await as(t, otherClinic).get('/api/audit-events').expect(200).then((r) => expect(r.body).toEqual([]));
    const note = (await write(psyA).expect(201)).body;
    await as(t, otherClinic).get(`/api/notes/${note.id}`).expect(403); // an owner: no record access at all
    const otherPsy = await addStaff(t, otherClinic, 'psychologist');
    await as(t, otherPsy).get(`/api/notes/${note.id}`).expect(404);
  });
});
