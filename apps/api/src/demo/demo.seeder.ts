import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { appointments, type AppointmentStatus } from '../appointments/appointments.schema.js';
import { addDays, localTime, zonedInstant } from '../appointments/clinic-time.js';
import { appointmentSeries } from '../appointments/series.schema.js';
import { SlotValidator } from '../appointments/slot-validator.js';
import { auditEvents } from '../audit/audit.schema.js';
import { CredentialsService } from '../auth/credentials.service.js';
import { timeOff, workingHours } from '../availability/availability.schema.js';
import { clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import type { Database, Transaction } from '../db/db.module.js';
import { NoteCipher, noteAad } from '../notes/note-cipher.js';
import { clinicalNotes } from '../notes/notes.schema.js';
import { patients } from '../patients/patients.schema.js';
import { rooms } from '../rooms/rooms.schema.js';
import { DEFAULT_SESSION_TYPES, sessionTypes } from '../session-types/session-types.schema.js';
import { users } from '../users/users.schema.js';
import {
  DEMO_CLINIC,
  DEMO_PASSWORD,
  DEMO_PATIENTS,
  DEMO_ROOMS,
  DEMO_STAFF,
  DEMO_TIME_OFF,
  DEMO_WORKING_HOURS,
  type DemoStaffKey,
  HISTORY_WEEKS,
} from './demo-data.js';

const BUFFER_MINUTES = 10;
const MINUTE = 60_000;

/**
 * Wipes the database and rebuilds the demo clinic around today. Past sessions are written as
 * history; future ones come from the real series job and slot validator, so the demo can only
 * contain what the rules allow.
 */
@Injectable()
export class DemoSeeder {
  private readonly logger = new Logger(DemoSeeder.name);
  private readonly cipher: NoteCipher;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly credentials: CredentialsService,
    private readonly slots: SlotValidator,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.cipher = new NoteCipher(config.get('NOTES_ENCRYPTION_KEYS', { infer: true }));
  }

  async isEmpty() {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(clinics);
    return row.count === 0;
  }

  /** Everything, including other clinics visitors signed up: the demo starts over. */
  async wipe() {
    const tables = await this.db.execute<{ name: string }>(sql`
      select format('%I.%I', schemaname, tablename) as name from pg_tables
      where schemaname = 'public' or (schemaname = 'nest_outbox' and tablename <> 'migrations')`);
    const names = tables.rows.map((t) => t.name);
    if (names.length) await this.db.execute(sql.raw(`truncate ${names.join(', ')} restart identity cascade`));
  }

  /** Returns the demo clinic's id. Future sessions are generated afterwards by the series job. */
  async seed(): Promise<string> {
    const passwordHashes = await Promise.all(Object.keys(DEMO_STAFF).map(() => this.credentials.hash(DEMO_PASSWORD)));
    const now = this.clock.now();
    const today = localTime(now, DEMO_CLINIC.timezone).date;

    return this.db.transaction(async (tx) => {
      const [clinic] = await tx.insert(clinics).values({ ...DEMO_CLINIC, bufferMinutes: BUFFER_MINUTES }).returning();
      const types = await tx
        .insert(sessionTypes)
        .values(DEFAULT_SESSION_TYPES.map((t) => ({ ...t, clinicId: clinic.id })))
        .returning();
      const typeByName = new Map(types.map((t) => [t.name, t]));

      const staffRows = await tx
        .insert(users)
        .values(Object.values(DEMO_STAFF).map((s, i) => ({ ...s, clinicId: clinic.id, passwordHash: passwordHashes[i] })))
        .returning();
      const staff = Object.fromEntries(
        (Object.keys(DEMO_STAFF) as DemoStaffKey[]).map((key) => [key, staffRows.find((u) => u.email === DEMO_STAFF[key].email)!]),
      ) as Record<DemoStaffKey, (typeof staffRows)[number]>;

      const roomRows = await tx
        .insert(rooms)
        .values(DEMO_ROOMS.map((name) => ({ name, clinicId: clinic.id })))
        .returning();
      const roomId = (name: string | null) => (name ? roomRows.find((r) => r.name === name)!.id : null);

      for (const [key, ranges] of Object.entries(DEMO_WORKING_HOURS) as [keyof typeof DEMO_WORKING_HOURS, (typeof DEMO_WORKING_HOURS)['rafael']][]) {
        await tx.insert(workingHours).values(
          ranges.map((r) => ({ clinicId: clinic.id, psychologistId: staff[key].id, weekday: r.weekday, startMinute: r.start, endMinute: r.end })),
        );
      }
      const offStart = addDays(today, DEMO_TIME_OFF.inDays);
      await tx.insert(timeOff).values({
        clinicId: clinic.id,
        psychologistId: staff[DEMO_TIME_OFF.psychologist].id,
        startsAt: zonedInstant(offStart, 0, DEMO_CLINIC.timezone),
        endsAt: zonedInstant(addDays(offStart, DEMO_TIME_OFF.days), 0, DEMO_CLINIC.timezone),
        reason: DEMO_TIME_OFF.reason,
      });

      for (const p of DEMO_PATIENTS) {
        const psychologist = staff[p.psychologist];
        const [patient] = await tx
          .insert(patients)
          .values({
            clinicId: clinic.id,
            psychologistId: psychologist.id,
            name: p.name,
            email: p.email ?? null,
            phone: p.phone ?? null,
            birthDate: p.birthDate ?? null,
            active: p.active ?? true,
          })
          .returning();

        const attended: { id: string; endsAt: Date }[] = [];
        if (p.series) {
          const s = p.series;
          const type = typeByName.get(s.type)!;
          const interval = s.intervalWeeks ?? 1;
          const anchorDate = firstWeekdayOnOrAfter(addDays(today, -HISTORY_WEEKS * 7), s.weekday);
          const [series] = await tx
            .insert(appointmentSeries)
            .values({
              clinicId: clinic.id,
              psychologistId: psychologist.id,
              patientId: patient.id,
              sessionTypeId: type.id,
              roomId: roomId(s.room),
              mode: s.room ? 'in_person' : 'online',
              anchorDate,
              startMinute: s.minute,
              intervalWeeks: interval,
              // The job generates everything after today.
              horizonDate: today,
              createdBy: staff.julia.id,
              createdAt: zonedInstant(anchorDate, 8 * 60, DEMO_CLINIC.timezone),
            })
            .returning();

          const dates: string[] = [];
          for (let date = anchorDate; date <= today; date = addDays(date, interval * 7)) dates.push(date);
          for (const [index, date] of dates.entries()) {
            const startsAt = zonedInstant(date, s.minute, DEMO_CLINIC.timezone);
            const endsAt = new Date(startsAt.getTime() + type.durationMinutes * MINUTE);
            const weeksBack = dates.length - 1 - index;
            const status: AppointmentStatus = startsAt > now ? 'scheduled' : (s.exceptions?.[weeksBack] ?? 'completed');
            const cancelled = status === 'cancelled' || status === 'late_cancelled';
            const [row] = await tx
              .insert(appointments)
              .values({
                clinicId: clinic.id,
                psychologistId: psychologist.id,
                patientId: patient.id,
                sessionTypeId: type.id,
                roomId: series.roomId,
                mode: series.mode,
                seriesId: series.id,
                occurrenceDate: date,
                startsAt,
                endsAt,
                blockedUntil: new Date(endsAt.getTime() + BUFFER_MINUTES * MINUTE),
                status,
                cancelledAt: cancelled ? new Date(startsAt.getTime() - (status === 'late_cancelled' ? 3 : 48) * 60 * MINUTE) : null,
                cancelledBy: cancelled ? (status === 'late_cancelled' ? 'patient' : 'clinic') : null,
                cancellationReason: status === 'cancelled' ? 'Psicóloga em atendimento de urgência' : null,
                // History already had its reminders.
                reminderQueuedFor: startsAt < now ? startsAt : null,
                reminderSentAt: startsAt < now ? new Date(startsAt.getTime() - 48 * 60 * MINUTE) : null,
                createdBy: staff.julia.id,
              })
              .returning({ id: appointments.id, endsAt: appointments.endsAt });
            if (status === 'completed') attended.push(row);
          }
        }

        if (p.oneOff) {
          const type = typeByName.get(p.oneOff.type)!;
          const request = {
            clinicId: clinic.id,
            psychologistId: psychologist.id,
            patientId: patient.id,
            sessionTypeId: type.id,
            mode: p.oneOff.room ? ('in_person' as const) : ('online' as const),
            roomId: roomId(p.oneOff.room),
          };
          const ranges = DEMO_WORKING_HOURS[p.psychologist];
          // First day from "inDays" on when the psychologist works at that time.
          let date = addDays(today, p.oneOff.inDays);
          while (!ranges.some((r) => r.weekday === weekdayOf(date) && r.start <= p.oneOff!.minute && p.oneOff!.minute + type.durationMinutes <= r.end)) {
            date = addDays(date, 1);
          }
          const times = await this.slots.validate(tx, request, zonedInstant(date, p.oneOff.minute, DEMO_CLINIC.timezone));
          await tx.insert(appointments).values({ ...request, ...times, createdBy: staff.julia.id });
        }

        if (p.notes) await this.writeNotes(tx, clinic.id, patient.id, psychologist.id, attended.slice(-p.notes.length), p.notes, p.addendum);
      }

      // The front desk tried to open a record once: denied, and on the audit trail.
      const ana = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.clinicId, clinic.id), eq(patients.name, DEMO_PATIENTS[0].name)));
      await tx.insert(auditEvents).values({
        clinicId: clinic.id,
        actorId: staff.julia.id,
        action: 'note.list',
        resourceType: 'clinical_note',
        patientId: ana[0].id,
        outcome: 'denied',
        at: new Date(now.getTime() - 26 * 60 * MINUTE),
      });
      return clinic.id;
    });
  }

  /** Confirms about half of the next three days' sessions, as patients would have. */
  async confirmSome(clinicId: string) {
    const now = this.clock.now();
    const upcoming = await this.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.status, 'scheduled'),
          gt(appointments.startsAt, now),
          lt(appointments.startsAt, new Date(now.getTime() + 72 * 60 * MINUTE)),
        ),
      )
      .orderBy(asc(appointments.startsAt));
    const ids = upcoming.filter((_, i) => i % 2 === 0).map((a) => a.id);
    if (ids.length) await this.db.update(appointments).set({ status: 'confirmed' }).where(inArray(appointments.id, ids));
    this.logger.log(`demo: ${ids.length} upcoming session(s) confirmed`);
  }

  private async writeNotes(
    tx: Transaction,
    clinicId: string,
    patientId: string,
    authorId: string,
    sessions: { id: string; endsAt: Date }[],
    contents: string[],
    addendum?: string,
  ) {
    const entries = sessions.map((session, i) => ({ session, content: contents[i], at: new Date(session.endsAt.getTime() + 20 * MINUTE) }));
    let firstId: string | null = null;
    for (const entry of entries) {
      const id = randomUUID();
      firstId ??= id;
      await this.insertNote(tx, { id, clinicId, patientId, authorId }, entry.content, entry.at, entry.session.id, null);
    }
    if (addendum && firstId && entries.length) {
      await this.insertNote(tx, { id: randomUUID(), clinicId, patientId, authorId }, addendum, new Date(entries[0].at.getTime() + 2 * 86_400_000), null, firstId);
    }
  }

  private async insertNote(
    tx: Transaction,
    binding: { id: string; clinicId: string; patientId: string; authorId: string },
    content: string,
    at: Date,
    appointmentId: string | null,
    amendsNoteId: string | null,
  ) {
    const encrypted = this.cipher.encrypt(content, noteAad(binding));
    await tx.insert(clinicalNotes).values({ ...binding, ...encrypted, appointmentId, amendsNoteId, createdAt: at });
    await tx.insert(auditEvents).values({
      clinicId: binding.clinicId,
      actorId: binding.authorId,
      action: 'note.create',
      resourceType: 'clinical_note',
      resourceId: binding.id,
      patientId: binding.patientId,
      outcome: 'allowed',
      at,
    });
  }
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

function firstWeekdayOnOrAfter(date: string, weekday: number) {
  return addDays(date, (weekday - weekdayOf(date) + 7) % 7);
}
