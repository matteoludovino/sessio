import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';
import { patients } from '../patients/patients.schema.js';
import { rooms } from '../rooms/rooms.schema.js';
import { sessionTypes } from '../session-types/session-types.schema.js';
import { users } from '../users/users.schema.js';

export const appointmentStatus = pgEnum('appointment_status', [
  'scheduled',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
  'late_cancelled',
]);
export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number];

export const appointmentMode = pgEnum('appointment_mode', ['in_person', 'online']);
export type AppointmentMode = (typeof appointmentMode.enumValues)[number];

export const cancelledBy = pgEnum('cancelled_by', ['patient', 'clinic']);

/**
 * Therapy sessions (named appointments in code, never to be confused with sign-in sessions).
 *
 * Overlaps are refused by exclusion constraints in the custom migration, over
 * [starts_at, blocked_until): blocked_until is the end plus the clinic's buffer at booking time,
 * so a later change of the buffer never reshapes existing sessions.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    psychologistId: uuid().notNull(),
    patientId: uuid().notNull(),
    sessionTypeId: uuid().notNull(),
    roomId: uuid(),
    mode: appointmentMode().notNull(),
    /** Set for occurrences of a series (stage 5), with the local date they were planned for. */
    seriesId: uuid(),
    /** Stays the same when the occurrence is rescheduled, so it is never generated twice. */
    occurrenceDate: date({ mode: 'string' }),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    blockedUntil: timestamp({ withTimezone: true }).notNull(),
    status: appointmentStatus().notNull().default('scheduled'),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: cancelledBy(),
    cancellationReason: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Every reference stays inside the clinic, enforced by the database.
    foreignKey({ name: 'appointments_psychologist_fk', columns: [t.clinicId, t.psychologistId], foreignColumns: [users.clinicId, users.id] }),
    foreignKey({ name: 'appointments_patient_fk', columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: 'appointments_session_type_fk', columns: [t.clinicId, t.sessionTypeId], foreignColumns: [sessionTypes.clinicId, sessionTypes.id] }),
    // MATCH SIMPLE: checked only when room_id is set (in-person sessions).
    foreignKey({ name: 'appointments_room_fk', columns: [t.clinicId, t.roomId], foreignColumns: [rooms.clinicId, rooms.id] }),
    // Composite FK to the series is declared in the series migration (avoids a circular import).
    uniqueIndex('appointments_series_occurrence_key').on(t.seriesId, t.occurrenceDate),
    index('appointments_clinic_starts_idx').on(t.clinicId, t.startsAt),
    index('appointments_psychologist_starts_idx').on(t.psychologistId, t.startsAt),
    index('appointments_patient_starts_idx').on(t.patientId, t.startsAt),
    check('appointments_time_check', sql`${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= ${t.blockedUntil}`),
    check('appointments_room_mode_check', sql`(${t.mode} = 'in_person') = (${t.roomId} is not null)`),
    check('appointments_series_check', sql`(${t.seriesId} is null) = (${t.occurrenceDate} is null)`),
    check(
      'appointments_cancellation_check',
      sql`(${t.status} in ('cancelled', 'late_cancelled')) = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null)`,
    ),
  ],
);

export type Appointment = typeof appointments.$inferSelect;

/** Statuses that hold the slot. Cancelled sessions free it; past ones keep it. */
export const BLOCKING_STATUSES = ['scheduled', 'confirmed', 'completed', 'no_show'] as const satisfies readonly AppointmentStatus[];
