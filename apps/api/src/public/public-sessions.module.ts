import { Body, Controller, GoneException, HttpCode, Get, Injectable, Module, NotFoundException, Param, Post, UnprocessableEntityException } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { aliasedTable, and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { allowedFrom, assertCan, cancellationStatus, RuleViolation } from '../appointments/appointment-rules.js';
import { type Appointment, appointments } from '../appointments/appointments.schema.js';
import { clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Database } from '../db/db.module.js';
import { LinkTokens } from '../notifications/link-tokens.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { rooms } from '../rooms/rooms.schema.js';
import { users } from '../users/users.schema.js';

const psychologist = aliasedTable(users, 'psychologist');
const tokenParam = z.string().min(20).max(300);
// The reason is optional, so is the body: a bare cancel button posts nothing.
const cancelBody = z.object({ reason: z.string().trim().max(300).optional() }).default({});

/**
 * What a patient can do from the link in a reminder, without an account. The link is the only
 * credential: it names one session at one start time, and shows nothing about anyone else.
 */
@Injectable()
export class PublicSessionsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly links: LinkTokens,
    private readonly clock: Clock,
  ) {}

  async view(token: string) {
    const { appointment, clinic, psychologistName, roomName } = await this.resolve(token);
    const now = this.clock.now();
    const can = (action: 'confirm' | 'cancel') => {
      try {
        assertCan(action, appointment.status, { now, startsAt: appointment.startsAt });
        return true;
      } catch {
        return false;
      }
    };
    return {
      clinicName: clinic.name,
      psychologistName,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      timezone: clinic.timezone,
      mode: appointment.mode,
      roomName,
      status: appointment.status,
      canConfirm: can('confirm'),
      canCancel: can('cancel'),
      lateCancelHours: clinic.lateCancelHours,
      /** Shown before the patient cancels, so a chargeable cancellation is never a surprise. */
      cancellingNowIsLate: cancellationStatus('patient', { now, startsAt: appointment.startsAt }, clinic.lateCancelHours) === 'late_cancelled',
    };
  }

  /** Idempotent: confirming a confirmed session is fine (a double click, a second tab). */
  async confirm(token: string) {
    const { appointment } = await this.resolve(token);
    if (appointment.status === 'confirmed') return { status: appointment.status };
    this.check('confirm', appointment);
    return this.apply(appointment, 'confirm', { status: 'confirmed' });
  }

  async cancel(token: string, reason?: string) {
    const { appointment, clinic } = await this.resolve(token);
    this.check('cancel', appointment);
    const now = this.clock.now();
    const status = cancellationStatus('patient', { now, startsAt: appointment.startsAt }, clinic.lateCancelHours);
    return this.apply(appointment, 'cancel', { status, cancelledAt: now, cancelledBy: 'patient', cancellationReason: reason ?? null });
  }

  private async resolve(token: string) {
    const link = this.links.verify(token);
    if (!link) throw new NotFoundException('Link inválido.');
    const [row] = await this.db
      .select({ appointment: appointments, clinic: clinics, psychologistName: psychologist.name, roomName: rooms.name })
      .from(appointments)
      .innerJoin(clinics, eq(clinics.id, appointments.clinicId))
      .innerJoin(psychologist, eq(psychologist.id, appointments.psychologistId))
      .leftJoin(rooms, eq(rooms.id, appointments.roomId))
      .where(eq(appointments.id, link.appointmentId));
    if (!row) throw new NotFoundException('Link inválido.');
    if (row.appointment.startsAt.getTime() !== link.startsAt.getTime()) {
      throw new GoneException('Este link não vale mais: o horário da sessão foi alterado. Use o link do lembrete mais recente.');
    }
    return row;
  }

  private check(action: 'confirm' | 'cancel', appointment: Appointment) {
    try {
      assertCan(action, appointment.status, { now: this.clock.now(), startsAt: appointment.startsAt });
    } catch (error) {
      if (error instanceof RuleViolation) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  /** Conditional, like the staff actions: a patient and the front desk acting at once can't both win. */
  private async apply(current: Appointment, action: 'confirm' | 'cancel', changes: Partial<Appointment>) {
    const [updated] = await this.db
      .update(appointments)
      .set(changes)
      .where(and(eq(appointments.id, current.id), eq(appointments.startsAt, current.startsAt), inArray(appointments.status, [...allowedFrom(action)])))
      .returning({ status: appointments.status });
    if (!updated) throw new GoneException('A sessão foi alterada enquanto você decidia. Abra o link novamente.');
    return updated;
  }
}

@Public()
@Controller('public/sessions')
export class PublicSessionsController {
  constructor(private readonly sessions: PublicSessionsService) {}

  @Get(':token')
  view(@Param('token', { schema: tokenParam }) token: string) {
    return this.sessions.view(token);
  }

  @Post(':token/confirm')
  @HttpCode(200)
  confirm(@Param('token', { schema: tokenParam }) token: string) {
    return this.sessions.confirm(token);
  }

  @Post(':token/cancel')
  @HttpCode(200)
  cancel(@Param('token', { schema: tokenParam }) token: string, @Body({ schema: cancelBody }) body: z.infer<typeof cancelBody>) {
    return this.sessions.cancel(token, body.reason);
  }
}

@Module({ imports: [NotificationsModule], controllers: [PublicSessionsController], providers: [PublicSessionsService] })
export class PublicSessionsModule {}
