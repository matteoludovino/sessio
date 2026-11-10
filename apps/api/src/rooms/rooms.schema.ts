import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';

/** Consulting rooms: a shared resource, so in-person sessions can't double-book one (stage 4). */
export const rooms = pgTable(
  'rooms',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rooms_clinic_name_key').on(t.clinicId, sql`lower(${t.name})`),
    unique('rooms_clinic_id_id_key').on(t.clinicId, t.id),
  ],
);

export type Room = typeof rooms.$inferSelect;
