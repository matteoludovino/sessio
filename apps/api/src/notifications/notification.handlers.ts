import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Mailer } from '@nestjs/mail';
import { OnOutboxMessage } from '@nestjs/outbox';
import { aliasedTable, eq } from 'drizzle-orm';
import { appointments } from '../appointments/appointments.schema.js';
import { clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import type { Database } from '../db/db.module.js';
import { patients } from '../patients/patients.schema.js';
import { rooms } from '../rooms/rooms.schema.js';
import { StaffInvitationMail } from '../staff/staff-invitation.mail.js';
import { users } from '../users/users.schema.js';
import { firstName, formatSessionTime } from './format.js';
import { LinkTokens } from './link-tokens.js';
import { INVITATION_TOPIC, type InvitationMessage, REMINDER_TOPIC, type ReminderMessage } from './notification-messages.js';
import { sentNotifications } from './notifications.schema.js';
import { ReminderMail } from './reminder.mail.js';

const psychologist = aliasedTable(users, 'psychologist');

/**
 * Outbox consumers. Each has an inbox (by consumer name), so a redelivered message is skipped.
 * Sending mail is outside the database, so "exactly once" isn't possible: if the process dies
 * after the mail server accepted a message and before the inbox records it, the retry sends it
 * again. A duplicate reminder is acceptable; a lost one isn't.
 */
@Injectable()
export class NotificationHandlers {
  private readonly logger = new Logger(NotificationHandlers.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly links: LinkTokens,
    private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @OnOutboxMessage(REMINDER_TOPIC, { consumer: 'appointment-reminder-email' })
  async sendReminder(message: ReminderMessage) {
    const [row] = await this.db
      .select({
        appointment: appointments,
        patientName: patients.name,
        patientEmail: patients.email,
        psychologistName: psychologist.name,
        clinicName: clinics.name,
        timezone: clinics.timezone,
        roomName: rooms.name,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(psychologist, eq(psychologist.id, appointments.psychologistId))
      .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
      .leftJoin(rooms, eq(rooms.id, appointments.roomId))
      .where(eq(appointments.id, message.appointmentId));

    // Checked at delivery time: what matters is the session now, not when the message was queued.
    const a = row?.appointment;
    const stale =
      !a ||
      !row.patientEmail ||
      !['scheduled', 'confirmed'].includes(a.status) ||
      a.startsAt.toISOString() !== message.startsAt ||
      a.startsAt <= this.clock.now();
    if (stale) {
      this.logger.debug(`Reminder for ${message.appointmentId} dropped: the session changed`);
      return;
    }
    const token = this.links.sign({ appointmentId: a.id, startsAt: a.startsAt });
    const manageUrl = new URL(`/sessao/${token}`, this.config.get('WEB_ORIGIN', { infer: true })).href;
    const data = {
      patientFirstName: firstName(row.patientName),
      psychologistName: row.psychologistName,
      clinicName: row.clinicName,
      when: formatSessionTime(a.startsAt, row.timezone),
      where: a.mode === 'online' ? 'atendimento online' : `presencial, ${row.roomName}`,
      manageUrl,
    };
    const to = { name: row.patientName, address: row.patientEmail! };
    await this.mailer.send(ReminderMail, { to, data });
    const rendered = await this.mailer.render(ReminderMail, { data });
    await this.record({ clinicId: a.clinicId, appointmentId: a.id, kind: 'appointment_reminder', recipient: to.address }, rendered);
    await this.db.update(appointments).set({ reminderSentAt: this.clock.now() }).where(eq(appointments.id, a.id));
  }

  @OnOutboxMessage(INVITATION_TOPIC, { consumer: 'staff-invitation-email' })
  async sendInvitation(message: InvitationMessage) {
    const data = {
      clinicName: message.clinicName,
      inviteeName: message.name,
      inviterName: message.inviterName,
      acceptUrl: message.acceptUrl,
    };
    await this.mailer.send(StaffInvitationMail, { to: { name: message.name, address: message.email }, data });
    const rendered = await this.mailer.render(StaffInvitationMail, { data });
    await this.record({ clinicId: message.clinicId, appointmentId: null, kind: 'staff_invitation', recipient: message.email }, rendered);
  }

  /** The body is kept only in demo mode, for the in-app outbox. */
  private async record(
    meta: { clinicId: string; appointmentId: string | null; kind: 'appointment_reminder' | 'staff_invitation'; recipient: string },
    rendered: { subject?: string; html?: string },
  ) {
    await this.db.insert(sentNotifications).values({
      ...meta,
      subject: rendered.subject ?? '',
      html: this.config.get('DEMO_MODE', { infer: true }) ? (rendered.html ?? null) : null,
      sentAt: this.clock.now(),
    });
  }
}
