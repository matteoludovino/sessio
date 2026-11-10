import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** The tenant: every business row belongs to exactly one clinic. */
export const clinics = pgTable('clinics', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** IANA zone used to interpret working hours, e.g. America/Sao_Paulo. */
  timezone: text().notNull().default('America/Sao_Paulo'),
  /** Patient cancellations closer than this to the start are late (chargeable). */
  lateCancelHours: integer().notNull().default(24),
  /** Mandatory gap after each session, protected by the database alongside the session itself. */
  bufferMinutes: integer().notNull().default(10),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type Clinic = typeof clinics.$inferSelect;
