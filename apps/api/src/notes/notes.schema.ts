import { foreignKey, index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointments } from '../appointments/appointments.schema.js';
import { clinics } from '../clinics/clinics.schema.js';
import { patients } from '../patients/patients.schema.js';
import { users } from '../users/users.schema.js';

/**
 * Clinical notes: content only as AES-256-GCM ciphertext, never in clear. Append-only: there is
 * no update or delete in the API; a correction is a new note that amends an earlier one.
 */
export const clinicalNotes = pgTable(
  'clinical_notes',
  {
    id: uuid().primaryKey(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    patientId: uuid().notNull(),
    /** The psychologist who wrote it: the only person who can read it. */
    authorId: uuid().notNull(),
    appointmentId: uuid().references(() => appointments.id),
    /** Set on an addendum: the note it corrects or completes. */
    amendsNoteId: uuid(),
    ciphertext: text().notNull(),
    iv: text().notNull(),
    tag: text().notNull(),
    keyVersion: smallint().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'clinical_notes_patient_fk', columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: 'clinical_notes_author_fk', columns: [t.clinicId, t.authorId], foreignColumns: [users.clinicId, users.id] }),
    foreignKey({ name: 'clinical_notes_amends_fk', columns: [t.amendsNoteId], foreignColumns: [t.id] }),
    index('clinical_notes_patient_author_idx').on(t.patientId, t.authorId, t.createdAt),
  ],
);

export type ClinicalNote = typeof clinicalNotes.$inferSelect;
