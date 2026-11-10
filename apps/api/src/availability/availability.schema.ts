import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';
import { users } from '../users/users.schema.js';

/**
 * Weekly working hours of a psychologist, in the clinic's time zone: weekday 0 = Sunday (as
 * JavaScript's getDay() and PostgreSQL's EXTRACT(DOW)), minutes since midnight. Several ranges a
 * day are fine; overlapping ones are rejected by an exclusion constraint (custom migration).
 */
export const workingHours = pgTable(
  'working_hours',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    psychologistId: uuid().notNull(),
    weekday: smallint().notNull(),
    startMinute: smallint().notNull(),
    endMinute: smallint().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'working_hours_psychologist_fk',
      columns: [t.clinicId, t.psychologistId],
      foreignColumns: [users.clinicId, users.id],
    }).onDelete('cascade'),
    index('working_hours_psychologist_idx').on(t.clinicId, t.psychologistId, t.weekday),
    check('working_hours_weekday_check', sql`${t.weekday} between 0 and 6`),
    check(
      'working_hours_range_check',
      sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);

/** Vacations and other absences, as absolute instants. Overlaps are rejected (custom migration). */
export const timeOff = pgTable(
  'time_off',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    psychologistId: uuid().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'time_off_psychologist_fk',
      columns: [t.clinicId, t.psychologistId],
      foreignColumns: [users.clinicId, users.id],
    }).onDelete('cascade'),
    index('time_off_psychologist_idx').on(t.clinicId, t.psychologistId, t.startsAt),
    check('time_off_range_check', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);
