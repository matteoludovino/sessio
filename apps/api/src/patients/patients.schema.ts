import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';
import { users } from '../users/users.schema.js';

/**
 * Administrative patient data only. Clinical content lives in notes (stage 7), visible to the
 * author alone. Patients are archived, never deleted here, so their session history stays whole.
 */
export const patients = pgTable(
  'patients',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    /** The psychologist responsible for the patient. */
    psychologistId: uuid().notNull(),
    name: text().notNull(),
    /** Optional: without it the patient gets no reminders. */
    email: text(),
    phone: text(),
    birthDate: date({ mode: 'string' }),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Same clinic enforced by the database: (clinic_id, psychologist_id) must be a user of that clinic.
    foreignKey({
      name: 'patients_psychologist_fk',
      columns: [t.clinicId, t.psychologistId],
      foreignColumns: [users.clinicId, users.id],
    }),
    unique('patients_clinic_id_id_key').on(t.clinicId, t.id),
    index('patients_clinic_psychologist_idx').on(t.clinicId, t.psychologistId),
    index('patients_clinic_name_idx').on(t.clinicId, sql`lower(${t.name})`),
  ],
);

export type Patient = typeof patients.$inferSelect;
