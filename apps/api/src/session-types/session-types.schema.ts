import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';

/** Kinds of session and their length, e.g. individual 50 min, couple 80 min. */
export const sessionTypes = pgTable(
  'session_types',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    durationMinutes: integer().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('session_types_clinic_name_key').on(t.clinicId, sql`lower(${t.name})`),
    unique('session_types_clinic_id_id_key').on(t.clinicId, t.id),
    check('session_types_duration_check', sql`${t.durationMinutes} between 15 and 240`),
  ],
);

export type SessionType = typeof sessionTypes.$inferSelect;

/** Created with every new clinic. */
export const DEFAULT_SESSION_TYPES = [
  { name: 'Individual', durationMinutes: 50 },
  { name: 'Casal', durationMinutes: 80 },
  { name: 'Avaliação', durationMinutes: 60 },
] as const;
