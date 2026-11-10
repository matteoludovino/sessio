/** Outbox topics and their payloads (JSON snapshots, taken when the message is added). */
export const REMINDER_TOPIC = 'appointment.reminder';
export interface ReminderMessage {
  appointmentId: string;
  /** The version reminded about; a later reschedule makes this message stale. */
  startsAt: string;
}

export const INVITATION_TOPIC = 'staff.invitation';
export interface InvitationMessage {
  clinicId: string;
  email: string;
  name: string;
  clinicName: string;
  inviterName: string;
  acceptUrl: string;
}
