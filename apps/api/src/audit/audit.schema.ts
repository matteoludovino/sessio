import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';

/**
 * Who did what to sensitive records, and when. Never their content. Denied attempts are recorded
 * too: accountability covers trying, not only succeeding.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    actorId: uuid().notNull(),
    action: text().notNull(),
    resourceType: text().notNull(),
    resourceId: uuid(),
    patientId: uuid(),
    outcome: text({ enum: ['allowed', 'denied'] }).notNull(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_clinic_at_idx').on(t.clinicId, t.at), index('audit_events_patient_idx').on(t.clinicId, t.patientId, t.at)],
);
