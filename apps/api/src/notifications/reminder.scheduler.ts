import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Outbox } from '@nestjs/outbox';
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { appointments } from '../appointments/appointments.schema.js';
import { clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Database, Transaction } from '../db/db.module.js';
import { patients } from '../patients/patients.schema.js';
import { REMINDER_TOPIC, type ReminderMessage } from './notification-messages.js';

/** A reminder an hour before a session (or later) is pointless: those are skipped. */
const MIN_NOTICE_HOURS = 1;
const BATCH = 200;

/**
 * Picks the sessions that are due a reminder now and queues one each, in the same transaction
 * that records "queued for this start time". It reads the current state, so cancelled and
 * rescheduled sessions are handled by construction, and SKIP LOCKED lets several runs share the
 * work without double queueing. The outbox then delivers, with retries.
 */
@Injectable()
export class ReminderScheduler {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly outbox: Outbox<Transaction>,
    private readonly clock: Clock,
  ) {}

  async enqueueDue(): Promise<number> {
    const now = this.clock.now();
    const from = new Date(now.getTime() + MIN_NOTICE_HOURS * 3_600_000);
    // Each clinic's own lead time: due once the session is closer than reminder_lead_hours.
    const leadEnd = sql`${now.toISOString()}::timestamptz + make_interval(hours => ${clinics.reminderLeadHours})`;
    const queued = await this.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: appointments.id, startsAt: appointments.startsAt })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
        .where(
          and(
            inArray(appointments.status, ['scheduled', 'confirmed']),
            gt(appointments.startsAt, from),
            lte(appointments.startsAt, leadEnd),
            isNotNull(patients.email),
            or(isNull(appointments.reminderQueuedFor), ne(appointments.reminderQueuedFor, appointments.startsAt)),
          ),
        )
        .limit(BATCH)
        .for('update', { of: appointments, skipLocked: true });
      if (!due.length) return 0;
      await this.outbox.add(
        tx,
        due.map((a) => ({
          topic: REMINDER_TOPIC,
          key: a.id,
          payload: { appointmentId: a.id, startsAt: a.startsAt.toISOString() } satisfies ReminderMessage,
        })),
      );
      for (const a of due) {
        await tx.update(appointments).set({ reminderQueuedFor: a.startsAt }).where(eq(appointments.id, a.id));
      }
      return due.length;
    });
    if (queued) this.outbox.notify();
    return queued;
  }
}
