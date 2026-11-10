import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { clinics } from '../clinics/clinics.schema.js';
import { staffRole, users } from '../users/users.schema.js';

/**
 * Pending staff invitations. Only the SHA-256 of the token is stored, and the token itself is
 * mailed to the invitee only: the owner never sees it, so the owner can't set a psychologist's
 * password and read their clinical notes.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    name: text().notNull(),
    role: staffRole().notNull(),
    tokenHash: text().notNull(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invitations_token_hash_key').on(t.tokenHash), index('invitations_clinic_id_idx').on(t.clinicId)],
);
