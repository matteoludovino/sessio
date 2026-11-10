import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuthorizationService } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Database, Executor } from '../db/db.module.js';
import { PgError, pgErrorCode } from '../db/errors.js';
import { patients } from '../patients/patients.schema.js';
import { Tenant } from '../tenancy/tenant.js';
import { users } from '../users/users.schema.js';
import { allowedFrom, cancellationStatus } from './appointment-rules.js';
import { AppointmentPolicy } from './appointment.policy.js';
import type { CancelDto, RescheduleDto } from './appointments.schemas.js';
import { appointments } from './appointments.schema.js';
import { AppointmentsService } from './appointments.service.js';
import { addDays, localTime, zonedInstant } from './clinic-time.js';
import type { CreateSeriesDto } from './series.schemas.js';
import { type AppointmentSeries, appointmentSeries } from './series.schema.js';
import { type ProblemReason, type SlotContext, type SlotRequest, SlotValidator } from './slot-validator.js';

/** Occurrences exist this far ahead; the job moves the horizon forward as weeks pass. */
export const HORIZON_WEEKS = 12;

interface Rule {
  anchorDate: string;
  intervalWeeks: number;
  untilDate: string | null;
  maxOccurrences: number | null;
}

interface PlannedOccurrence {
  occurrenceDate: string;
  startsAt: Date;
}

export interface SkippedOccurrence {
  occurrenceDate: string;
  startsAt: Date;
  reason: ProblemReason;
  message: string;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Occurrence dates of a rule in (after, upTo]: the k-th falls 7·interval·k days after the anchor. */
export function occurrenceDates(rule: Rule, upTo: string, after?: string): string[] {
  const dates: string[] = [];
  for (let k = 0; ; k++) {
    if (rule.maxOccurrences !== null && k >= rule.maxOccurrences) break;
    const date = addDays(rule.anchorDate, 7 * rule.intervalWeeks * k);
    if (date > upTo || (rule.untilDate && date > rule.untilDate)) break;
    if (!after || date > after) dates.push(date);
  }
  return dates;
}

/** Position of an occurrence in its series (0 for the anchor). */
const occurrenceIndex = (rule: Rule, date: string) => Math.round(daysBetween(rule.anchorDate, date) / (7 * rule.intervalWeeks));

@Injectable()
export class SeriesService {
  private readonly logger = new Logger(SeriesService.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
    private readonly authz: AuthorizationService,
    private readonly clock: Clock,
    private readonly slots: SlotValidator,
    private readonly appointments: AppointmentsService,
  ) {}

  /**
   * All or nothing: every date up to the horizon is checked, and any conflict refuses the whole
   * series with the full list (409), unless the caller asked to skip those dates.
   */
  async create(dto: CreateSeriesDto) {
    const user = this.tenant.user();
    const patient = await this.findPatient(dto.patientId);
    await this.authz.authorize(AppointmentPolicy, 'manage', user, patient.psychologistId);
    const request: SlotRequest = {
      clinicId: user.clinicId,
      psychologistId: patient.psychologistId,
      patientId: patient.id,
      sessionTypeId: dto.sessionTypeId,
      mode: dto.mode,
      roomId: dto.roomId ?? null,
    };
    return this.db.transaction(async (tx) => {
      const ctx = await this.slots.load(tx, request);
      const start = localTime(dto.startsAt, ctx.clinic.timezone);
      if (dto.untilDate && dto.untilDate < start.date) {
        throw new UnprocessableEntityException('A data final é anterior à primeira sessão.');
      }
      const rule: Rule = {
        anchorDate: start.date,
        intervalWeeks: dto.intervalWeeks,
        untilDate: dto.untilDate ?? null,
        maxOccurrences: dto.maxOccurrences ?? null,
      };
      return this.createSeries(tx, ctx, rule, start.minute, user.id, dto.skipConflicts);
    });
  }

  async get(id: string) {
    const user = this.tenant.user();
    const series = await this.find(this.db, id);
    if (!(await this.authz.can(AppointmentPolicy, 'manage', user, series.psychologistId))) {
      throw new NotFoundException();
    }
    const occurrences = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.clinicId, series.clinicId), eq(appointments.seriesId, series.id)))
      .orderBy(asc(appointments.occurrenceDate));
    return { series, occurrences };
  }

  /**
   * "This and following": the old series ends before this occurrence (its history stays), and a
   * new series starts at the new time with what was left. All or nothing, like creation.
   */
  async rescheduleFollowing(appointmentId: string, dto: RescheduleDto) {
    const current = await this.appointments.get(appointmentId);
    const { seriesId, occurrenceDate } = this.assertOccurrence(current);
    this.appointments.check('reschedule', current);
    return this.db.transaction(async (tx) => {
      const series = await this.lock(tx, seriesId);
      await this.endBefore(tx, series, occurrenceDate);
      await tx
        .delete(appointments)
        .where(
          and(
            eq(appointments.seriesId, series.id),
            gte(appointments.occurrenceDate, occurrenceDate),
            inArray(appointments.status, [...allowedFrom('reschedule')]),
          ),
        );
      const mode = dto.mode ?? series.mode;
      const roomId = mode === 'online' ? null : dto.roomId !== undefined ? dto.roomId : series.roomId;
      const ctx = await this.slots.load(tx, { ...series, mode, roomId });
      const start = localTime(dto.startsAt, ctx.clinic.timezone);
      const used = occurrenceIndex(series, occurrenceDate);
      const rule: Rule = {
        anchorDate: start.date,
        intervalWeeks: series.intervalWeeks,
        untilDate: series.untilDate,
        maxOccurrences: series.maxOccurrences === null ? null : series.maxOccurrences - used,
      };
      return this.createSeries(tx, ctx, rule, start.minute, this.tenant.user().id, false);
    });
  }

  /** Cancels this and every later occurrence and ends the series. The policy applies to each. */
  async cancelFollowing(appointmentId: string, dto: CancelDto) {
    const current = await this.appointments.get(appointmentId);
    const { seriesId, occurrenceDate } = this.assertOccurrence(current);
    this.appointments.check('cancel', current);
    return this.db.transaction(async (tx) => {
      const series = await this.lock(tx, seriesId);
      await this.endBefore(tx, series, occurrenceDate);
      const [clinic] = await tx.select().from(clinics).where(eq(clinics.id, series.clinicId));
      const now = this.clock.now();
      const pending = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.seriesId, series.id),
            gte(appointments.occurrenceDate, occurrenceDate),
            inArray(appointments.status, [...allowedFrom('cancel')]),
          ),
        );
      let cancelled = 0;
      for (const occurrence of pending.filter((o) => o.startsAt > now)) {
        const status = cancellationStatus(dto.by, { now, startsAt: occurrence.startsAt }, clinic.lateCancelHours);
        const updated = await tx
          .update(appointments)
          .set({ status, cancelledAt: now, cancelledBy: dto.by, cancellationReason: dto.reason ?? null })
          .where(and(eq(appointments.id, occurrence.id), inArray(appointments.status, [...allowedFrom('cancel')])))
          .returning({ id: appointments.id });
        cancelled += updated.length;
      }
      return { cancelled };
    });
  }

  /**
   * The job: moves every open series' horizon forward and creates the new occurrences. Nobody can
   * be asked about a conflict here, so conflicting dates are skipped and reported. Series are
   * locked with SKIP LOCKED, and inserts ignore existing (series, date) pairs: concurrent runs
   * neither block each other nor create duplicates.
   */
  async extendHorizons() {
    const candidates = await this.db
      .select({ id: appointmentSeries.id })
      .from(appointmentSeries)
      .where(or(isNull(appointmentSeries.untilDate), lt(appointmentSeries.horizonDate, appointmentSeries.untilDate)));
    const stats = { series: 0, created: 0, skipped: 0 };
    for (const { id } of candidates) {
      try {
        const result = await this.db.transaction(async (tx) => this.extendOne(tx, id));
        if (result) {
          stats.series++;
          stats.created += result.created;
          stats.skipped += result.skipped;
        }
      } catch (error) {
        // One broken series (archived patient, inactive session type...) doesn't stop the others.
        this.logger.warn(`Series ${id} not extended: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return stats;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async createSeries(tx: Executor, ctx: SlotContext, rule: Rule, startMinute: number, createdBy: string, skipConflicts: boolean) {
    const horizon = this.horizonFor(ctx.clinic.timezone, rule.untilDate);
    const { planned, skipped } = await this.plan(tx, ctx, rule, startMinute, horizon);
    if (skipped.length && !skipConflicts) {
      throw new ConflictException({
        statusCode: 409,
        message: `${skipped.length} data(s) da série têm conflito.`,
        conflicts: skipped,
      });
    }
    if (!planned.length) {
      throw new UnprocessableEntityException('Nenhuma data da série está disponível.');
    }
    // Fields picked one by one: the request may be an old series row (on "following" changes),
    // whose id and dates must not leak into the new one.
    const { clinicId, psychologistId, patientId, sessionTypeId, mode, roomId } = ctx.request;
    const [series] = await tx
      .insert(appointmentSeries)
      .values({ clinicId, psychologistId, patientId, sessionTypeId, mode, roomId, ...rule, startMinute, horizonDate: horizon, createdBy })
      .returning();
    // Inside the transaction: if a racing request took a slot, the exclusion constraint fails
    // the insert and the whole series rolls back (the filter answers 409).
    const occurrences = await tx
      .insert(appointments)
      .values(planned.map((o) => this.occurrenceRow(ctx, series, o, createdBy)))
      .returning();
    return { series, occurrences, skipped };
  }

  private async extendOne(tx: Executor, id: string) {
    const [series] = await tx.select().from(appointmentSeries).where(eq(appointmentSeries.id, id)).for('update', { skipLocked: true });
    if (!series) {
      return null; // another run holds it
    }
    const [owner] = await tx
      .select({ active: patients.active, psychologistActive: users.active })
      .from(patients)
      .innerJoin(users, eq(users.id, series.psychologistId))
      .where(eq(patients.id, series.patientId));
    if (!owner?.active || !owner.psychologistActive) {
      return null; // archived patient or deactivated psychologist: nothing new is generated
    }
    const ctx = await this.slots.load(tx, series);
    const horizon = this.horizonFor(ctx.clinic.timezone, series.untilDate);
    if (horizon <= series.horizonDate) {
      return null;
    }
    const { planned, skipped } = await this.plan(tx, ctx, series, series.startMinute, horizon, series.horizonDate);
    let created = 0;
    let lost = 0;
    for (const occurrence of planned) {
      try {
        // A savepoint per occurrence: a slot taken meanwhile skips that date, not the whole run.
        const rows = await tx.transaction((sp) =>
          sp
            .insert(appointments)
            .values(this.occurrenceRow(ctx, series, occurrence, series.createdBy))
            .onConflictDoNothing({ target: [appointments.seriesId, appointments.occurrenceDate] })
            .returning({ id: appointments.id }),
        );
        created += rows.length;
      } catch (error) {
        if (pgErrorCode(error) !== PgError.exclusionViolation) throw error;
        lost++;
      }
    }
    await tx.update(appointmentSeries).set({ horizonDate: horizon }).where(eq(appointmentSeries.id, series.id));
    if (skipped.length + lost) {
      this.logger.warn(`Series ${series.id}: ${skipped.length + lost} date(s) skipped because of conflicts`);
    }
    return { created, skipped: skipped.length + lost };
  }

  private async plan(tx: Executor, ctx: SlotContext, rule: Rule, startMinute: number, horizon: string, after?: string) {
    const planned: PlannedOccurrence[] = [];
    const skipped: SkippedOccurrence[] = [];
    for (const occurrenceDate of occurrenceDates(rule, horizon, after)) {
      const startsAt = zonedInstant(occurrenceDate, startMinute, ctx.clinic.timezone);
      const result = await this.slots.evaluate(tx, ctx, startsAt);
      if (result.ok) {
        planned.push({ occurrenceDate, startsAt });
      } else {
        skipped.push({ occurrenceDate, startsAt, reason: result.reason, message: result.message });
      }
    }
    return { planned, skipped };
  }

  private occurrenceRow(ctx: SlotContext, series: AppointmentSeries, o: PlannedOccurrence, createdBy: string) {
    const endsAt = new Date(o.startsAt.getTime() + ctx.sessionType.durationMinutes * 60_000);
    return {
      clinicId: series.clinicId,
      psychologistId: series.psychologistId,
      patientId: series.patientId,
      sessionTypeId: series.sessionTypeId,
      mode: series.mode,
      roomId: series.roomId,
      seriesId: series.id,
      occurrenceDate: o.occurrenceDate,
      startsAt: o.startsAt,
      endsAt,
      blockedUntil: new Date(endsAt.getTime() + ctx.clinic.bufferMinutes * 60_000),
      createdBy,
    };
  }

  /** Today in the clinic plus the horizon, capped at the series' last date. */
  private horizonFor(timeZone: string, untilDate: string | null): string {
    const horizon = addDays(localTime(this.clock.now(), timeZone).date, HORIZON_WEEKS * 7);
    return untilDate && untilDate < horizon ? untilDate : horizon;
  }

  private async endBefore(tx: Executor, series: AppointmentSeries, occurrenceDate: string) {
    const until = addDays(occurrenceDate, -1);
    await tx.update(appointmentSeries).set({ untilDate: until }).where(eq(appointmentSeries.id, series.id));
  }

  private assertOccurrence(appointment: { seriesId: string | null; occurrenceDate: string | null }) {
    if (!appointment.seriesId || !appointment.occurrenceDate) {
      throw new UnprocessableEntityException('Esta sessão não faz parte de uma série.');
    }
    return { seriesId: appointment.seriesId, occurrenceDate: appointment.occurrenceDate };
  }

  private async lock(tx: Executor, id: string) {
    const [series] = await tx
      .select()
      .from(appointmentSeries)
      .where(and(eq(appointmentSeries.clinicId, this.tenant.clinicId()), eq(appointmentSeries.id, id)))
      .for('update');
    if (!series) throw new NotFoundException();
    return series;
  }

  private async find(tx: Executor, id: string) {
    const [series] = await tx
      .select()
      .from(appointmentSeries)
      .where(and(eq(appointmentSeries.clinicId, this.tenant.clinicId()), eq(appointmentSeries.id, id)));
    if (!series) throw new NotFoundException();
    return series;
  }

  private async findPatient(id: string) {
    const [patient] = await this.db
      .select()
      .from(patients)
      .where(and(eq(patients.clinicId, this.tenant.clinicId()), eq(patients.id, id), eq(patients.active, true)));
    if (!patient) {
      throw new UnprocessableEntityException('Paciente não encontrado ou arquivado.');
    }
    return patient;
  }
}
