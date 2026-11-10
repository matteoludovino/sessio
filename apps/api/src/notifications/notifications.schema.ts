import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointments } from '../appointments/appointments.schema.js';
import { clinics } from '../clinics/clinics.schema.js';

export const notificationKind = pgEnum('notification_kind', ['appointment_reminder', 'staff_invitation']);

/**
 * What was sent, for the front desk ("reminder sent at 10:02"). The body is kept only in demo
 * mode, where nothing leaves the server and the UI shows the mail with its working links.
 */
export const sentNotifications = pgTable(
  'sent_notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    clinicId: uuid()
      .notNull()
      .references(() => clinics.id, { onDelete: 'cascade' }),
    appointmentId: uuid().references(() => appointments.id, { onDelete: 'set null' }),
    kind: notificationKind().notNull(),
    recipient: text().notNull(),
    subject: text().notNull(),
    html: text(),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sent_notifications_clinic_sent_idx').on(t.clinicId, t.sentAt)],
);
