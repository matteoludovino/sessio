import { boolean, index, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';

export const staffRole = pgEnum('staff_role', ['owner', 'reception', 'psychologist']);
export type StaffRole = (typeof staffRole.enumValues)[number];

/** Clinic staff. Patients never sign in: they act through the links in their reminders. */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    /** Stored normalized (trimmed, NFC, lower case): one account per address. */
    email: text().notNull(),
    name: text().notNull(),
    role: staffRole().notNull(),
    passwordHash: text(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    index('users_clinic_id_idx').on(t.clinicId),
    // Target of composite foreign keys: a row can only point at staff of its own clinic.
    unique('users_clinic_id_id_key').on(t.clinicId, t.id),
  ],
);

export type UserRow = typeof users.$inferSelect;
