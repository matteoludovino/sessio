import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { timeOff, workingHours } from '../availability/availability.schema.js';
import { type Clinic, clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Executor } from '../db/db.module.js';
import { rooms } from '../rooms/rooms.schema.js';
import { type SessionType, sessionTypes } from '../session-types/session-types.schema.js';
import { type AppointmentMode, appointments, BLOCKING_STATUSES } from './appointments.schema.js';
import { fitsWorkingHours, type WeeklyRange } from './clinic-time.js';

export interface SlotRequest {
  clinicId: string;
  psychologistId: string;
  patientId: string;
  sessionTypeId: string;
  mode: AppointmentMode;
  roomId: string | null;
  /** On reschedule: the session itself doesn't conflict with its own old slot. */
  excludeId?: string;
}

/** What doesn't depend on the date: loaded once, then reused for every occurrence of a series. */
export interface SlotContext {
  request: SlotRequest;
  clinic: Clinic;
  sessionType: SessionType;
  workingHours: WeeklyRange[];
}

export type ProblemReason = 'past' | 'working_hours' | 'time_off' | 'psychologist' | 'room' | 'patient';

export interface Conflict {
  reason: 'psychologist' | 'room' | 'patient';
  startsAt: Date;
  endsAt: Date;
}

export interface SlotTimes {
  startsAt: Date;
  endsAt: Date;
  blockedUntil: Date;
}

export type SlotEvaluation =
  | { ok: true; times: SlotTimes }
  | { ok: false; reason: ProblemReason; message: string; conflicts?: Conflict[] };

const MESSAGES: Record<ProblemReason, string> = {
  past: 'A sessão precisa começar no futuro.',
  working_hours: 'Fora do horário de trabalho do psicólogo.',
  time_off: 'O psicólogo estará ausente neste horário.',
  psychologist: 'O psicólogo já tem uma sessão neste horário (considerando o intervalo entre sessões).',
  room: 'A sala já está ocupada neste horário.',
  patient: 'O paciente já tem uma sessão neste horário.',
};

/**
 * Every rule a slot must pass, as data: a series evaluates all its dates and reports every
 * problem at once. The database's exclusion constraints still make the final call on overlaps.
 * Needs no signed-in user, so the horizon job can use it too.
 */
@Injectable()
export class SlotValidator {
  constructor(private readonly clock: Clock) {}

  /** Throws 422 for problems that no date can fix (inactive type, missing room...). */
  async load(tx: Executor, request: SlotRequest): Promise<SlotContext> {
    const [clinic] = await tx.select().from(clinics).where(eq(clinics.id, request.clinicId));
    const [sessionType] = await tx
      .select()
      .from(sessionTypes)
      .where(and(eq(sessionTypes.clinicId, request.clinicId), eq(sessionTypes.id, request.sessionTypeId), eq(sessionTypes.active, true)));
    if (!sessionType) {
      throw new UnprocessableEntityException('Tipo de sessão não encontrado ou inativo.');
    }
    if (request.mode === 'in_person') {
      if (!request.roomId) {
        throw new UnprocessableEntityException('Sessão presencial precisa de uma sala.');
      }
      const [room] = await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.clinicId, request.clinicId), eq(rooms.id, request.roomId), eq(rooms.active, true)));
      if (!room) {
        throw new UnprocessableEntityException('Sala não encontrada ou inativa.');
      }
    } else if (request.roomId) {
      throw new UnprocessableEntityException('Sessão online não usa sala.');
    }
    const hours = await tx
      .select()
      .from(workingHours)
      .where(and(eq(workingHours.clinicId, request.clinicId), eq(workingHours.psychologistId, request.psychologistId)));
    return { request, clinic, sessionType, workingHours: hours };
  }

  async evaluate(tx: Executor, ctx: SlotContext, startsAt: Date): Promise<SlotEvaluation> {
    const { request, clinic, sessionType } = ctx;
    const endsAt = new Date(startsAt.getTime() + sessionType.durationMinutes * 60_000);
    const blockedUntil = new Date(endsAt.getTime() + clinic.bufferMinutes * 60_000);
    const problem = (reason: ProblemReason, conflicts?: Conflict[]): SlotEvaluation => ({
      ok: false,
      reason,
      message: MESSAGES[reason],
      ...(conflicts && { conflicts }),
    });

    if (startsAt.getTime() <= this.clock.now().getTime()) {
      return problem('past');
    }
    if (!fitsWorkingHours(startsAt, endsAt, clinic.timezone, ctx.workingHours)) {
      return problem('working_hours');
    }
    const [absence] = await tx
      .select({ id: timeOff.id })
      .from(timeOff)
      .where(
        and(
          eq(timeOff.clinicId, request.clinicId),
          eq(timeOff.psychologistId, request.psychologistId),
          lt(timeOff.startsAt, endsAt),
          gt(timeOff.endsAt, startsAt),
        ),
      );
    if (absence) {
      return problem('time_off');
    }
    const conflicts = await this.findConflicts(tx, request, { startsAt, endsAt, blockedUntil });
    if (conflicts.length) {
      return problem(conflicts[0].reason, conflicts);
    }
    return { ok: true, times: { startsAt, endsAt, blockedUntil } };
  }

  /** load + evaluate for a single slot, as HTTP errors: 409 for conflicts, 422 for the rest. */
  async validate(tx: Executor, request: SlotRequest, startsAt: Date): Promise<SlotTimes> {
    const result = await this.evaluate(tx, await this.load(tx, request), startsAt);
    if (result.ok) {
      return result.times;
    }
    if (result.conflicts) {
      throw new ConflictException({ statusCode: 409, message: result.message, conflicts: result.conflicts });
    }
    throw new UnprocessableEntityException(result.message);
  }

  /** The same overlap rules as the exclusion constraints, to explain what is in the way. */
  private async findConflicts(tx: Executor, request: SlotRequest, { startsAt, endsAt, blockedUntil }: SlotTimes): Promise<Conflict[]> {
    const base = [
      eq(appointments.clinicId, request.clinicId),
      inArray(appointments.status, [...BLOCKING_STATUSES]),
      ...(request.excludeId ? [ne(appointments.id, request.excludeId)] : []),
    ];
    const blockedOverlap = and(lt(appointments.startsAt, blockedUntil), gt(appointments.blockedUntil, startsAt));
    const select = { startsAt: appointments.startsAt, endsAt: appointments.endsAt };
    const [byPsychologist, byRoom, byPatient] = await Promise.all([
      tx.select(select).from(appointments).where(and(...base, eq(appointments.psychologistId, request.psychologistId), blockedOverlap)),
      request.roomId
        ? tx.select(select).from(appointments).where(and(...base, eq(appointments.roomId, request.roomId), blockedOverlap))
        : Promise.resolve([]),
      tx
        .select(select)
        .from(appointments)
        .where(and(...base, eq(appointments.patientId, request.patientId), lt(appointments.startsAt, endsAt), gt(appointments.endsAt, startsAt))),
    ]);
    return [
      ...byPsychologist.map((c) => ({ reason: 'psychologist' as const, ...c })),
      ...byRoom.map((c) => ({ reason: 'room' as const, ...c })),
      ...byPatient.map((c) => ({ reason: 'patient' as const, ...c })),
    ];
  }
}
