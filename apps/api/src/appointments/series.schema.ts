import { sql } from 'drizzle-orm';
import { check, date, foreignKey, integer, pgTable, smallint, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';
import { patients } from '../patients/patients.schema.js';
import { rooms } from '../rooms/rooms.schema.js';
import { sessionTypes } from '../session-types/session-types.schema.js';
import { users } from '../users/users.schema.js';
import { appointmentMode } from './appointments.schema.js';

/**
 * A weekly (or biweekly) series: "every Tuesday at 08:00 until discharge". Its occurrences are
 * ordinary appointments, materialized up to `horizon_date` and extended by a job, so every
 * appointment rule applies to each of them. The local time and weekday come from the anchor, in
 * the clinic's time zone.
 */
export const appointmentSeries = pgTable(
  'appointment_series',
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
    /** Local date of the first occurrence. */
    anchorDate: date({ mode: 'string' }).notNull(),
    /** Local start time, minutes since midnight. */
    startMinute: smallint().notNull(),
    intervalWeeks: smallint().notNull().default(1),
    /** Last local date an occurrence may fall on (inclusive). Null: open-ended. */
    untilDate: date({ mode: 'string' }),
    maxOccurrences: integer(),
    /** Occurrences exist for every date up to here (inclusive); the job only ever moves it forward. */
    horizonDate: date({ mode: 'string' }).notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'series_psychologist_fk', columns: [t.clinicId, t.psychologistId], foreignColumns: [users.clinicId, users.id] }),
    foreignKey({ name: 'series_patient_fk', columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: 'series_session_type_fk', columns: [t.clinicId, t.sessionTypeId], foreignColumns: [sessionTypes.clinicId, sessionTypes.id] }),
    foreignKey({ name: 'series_room_fk', columns: [t.clinicId, t.roomId], foreignColumns: [rooms.clinicId, rooms.id] }),
    unique('appointment_series_clinic_id_id_key').on(t.clinicId, t.id),
    check('series_interval_check', sql`${t.intervalWeeks} in (1, 2)`),
    check('series_start_minute_check', sql`${t.startMinute} between 0 and 1439`),
    check('series_max_occurrences_check', sql`${t.maxOccurrences} is null or ${t.maxOccurrences} between 1 and 520`),
    check('series_room_mode_check', sql`(${t.mode} = 'in_person') = (${t.roomId} is not null)`),
  ],
);

export type AppointmentSeries = typeof appointmentSeries.$inferSelect;
