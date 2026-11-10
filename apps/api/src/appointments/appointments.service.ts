import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthorizationService } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { aliasedTable, and, asc, eq, gt, inArray, lt, ne, type SQL } from 'drizzle-orm';
import type { User } from '../auth/user.js';
import { timeOff, workingHours } from '../availability/availability.schema.js';
import { clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Database, Executor } from '../db/db.module.js';
import { patients } from '../patients/patients.schema.js';
import { rooms } from '../rooms/rooms.schema.js';
import { sessionTypes } from '../session-types/session-types.schema.js';
import { Tenant } from '../tenancy/tenant.js';
import { users } from '../users/users.schema.js';
import { type AppointmentAction, allowedFrom, assertCan, cancellationStatus, RuleViolation } from './appointment-rules.js';
import { AppointmentPolicy } from './appointment.policy.js';
import type { CancelDto, CreateAppointmentDto, ListQuery, RescheduleDto } from './appointments.schemas.js';
import { type Appointment, type AppointmentMode, appointments, BLOCKING_STATUSES } from './appointments.schema.js';
import { fitsWorkingHours } from './clinic-time.js';

interface Slot {
  clinicId: string;
  psychologistId: string;
  patientId: string;
  sessionTypeId: string;
  mode: AppointmentMode;
  roomId: string | null;
  startsAt: Date;
  /** On reschedule: the session itself doesn't conflict with its own old slot. */
  excludeId?: string;
}

export interface Conflict {
  reason: 'psychologist' | 'room' | 'patient';
  startsAt: Date;
  endsAt: Date;
}

const psychologist = aliasedTable(users, 'psychologist');

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
    private readonly authz: AuthorizationService,
    private readonly clock: Clock,
  ) {}

  // ── Reading ──────────────────────────────────────────────────────────────────

  /**
   * The calendar. A psychologist sees colleagues' sessions as busy slots, without the patient:
   * enough to find a free room, nothing about who their colleagues treat.
   */
  async list(query: ListQuery) {
    const user = this.tenant.user();
    const conditions: SQL[] = [
      eq(appointments.clinicId, user.clinicId),
      lt(appointments.startsAt, query.to),
      gt(appointments.endsAt, query.from),
    ];
    if (query.psychologistId) conditions.push(eq(appointments.psychologistId, query.psychologistId));
    if (query.roomId) conditions.push(eq(appointments.roomId, query.roomId));
    if (query.patientId) conditions.push(eq(appointments.patientId, query.patientId));

    const rows = await this.db
      .select({
        appointment: appointments,
        patientName: patients.name,
        psychologistName: psychologist.name,
        sessionTypeName: sessionTypes.name,
        roomName: rooms.name,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(psychologist, eq(psychologist.id, appointments.psychologistId))
      .innerJoin(sessionTypes, eq(sessionTypes.id, appointments.sessionTypeId))
      .leftJoin(rooms, eq(rooms.id, appointments.roomId))
      .where(and(...conditions))
      .orderBy(asc(appointments.startsAt))
      .limit(2000);

    return Promise.all(rows.map(async (row) => this.present(user, row)));
  }

  async get(id: string) {
    const user = this.tenant.user();
    const appointment = await this.find(id);
    // Someone else's session is not found for a psychologist: no existence leak.
    if (!(await this.authz.can(AppointmentPolicy, 'manage', user, appointment.psychologistId))) {
      throw new NotFoundException();
    }
    return appointment;
  }

  // ── Booking ──────────────────────────────────────────────────────────────────

  async create(dto: CreateAppointmentDto) {
    const user = this.tenant.user();
    const patient = await this.findPatient(dto.patientId);
    await this.authz.authorize(AppointmentPolicy, 'manage', user, patient.psychologistId);

    const slot: Slot = {
      clinicId: user.clinicId,
      psychologistId: patient.psychologistId,
      patientId: patient.id,
      sessionTypeId: dto.sessionTypeId,
      mode: dto.mode,
      roomId: dto.roomId ?? null,
      startsAt: dto.startsAt,
    };
    const times = await this.validateSlot(this.db, slot);
    // The database's exclusion constraints make the final call, also between racing requests.
    const [created] = await this.db
      .insert(appointments)
      .values({ ...slot, ...times, createdBy: user.id })
      .returning();
    return created;
  }

  /** Moves the session; it goes back to "scheduled" because the patient must confirm the new time. */
  async reschedule(id: string, dto: RescheduleDto) {
    const current = await this.get(id);
    this.check('reschedule', current);
    const mode = dto.mode ?? current.mode;
    const roomId = mode === 'online' ? null : dto.roomId !== undefined ? dto.roomId : current.roomId;
    const slot: Slot = { ...current, mode, roomId, startsAt: dto.startsAt, excludeId: current.id };
    const times = await this.validateSlot(this.db, slot);
    return this.transition(current, 'reschedule', { ...times, mode, roomId, status: 'scheduled' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async confirm(id: string) {
    const current = await this.get(id);
    this.check('confirm', current);
    return this.transition(current, 'confirm', { status: 'confirmed' });
  }

  async complete(id: string) {
    const current = await this.get(id);
    this.check('complete', current);
    return this.transition(current, 'complete', { status: 'completed' });
  }

  async noShow(id: string) {
    const current = await this.get(id);
    this.check('noShow', current);
    return this.transition(current, 'noShow', { status: 'no_show' });
  }

  async cancel(id: string, dto: CancelDto) {
    const current = await this.get(id);
    this.check('cancel', current);
    const [clinic] = await this.db
      .select({ lateCancelHours: clinics.lateCancelHours })
      .from(clinics)
      .where(eq(clinics.id, current.clinicId));
    const now = this.clock.now();
    const status = cancellationStatus(dto.by, { now, startsAt: current.startsAt }, clinic.lateCancelHours);
    return this.transition(current, 'cancel', {
      status,
      cancelledAt: now,
      cancelledBy: dto.by,
      cancellationReason: dto.reason ?? null,
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private check(action: AppointmentAction, appointment: Appointment) {
    try {
      assertCan(action, appointment.status, { now: this.clock.now(), startsAt: appointment.startsAt });
    } catch (error) {
      if (error instanceof RuleViolation) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }

  /**
   * Conditional UPDATE: applies only if the status is still one the action may start from.
   * Two staff members confirming and cancelling at once can't both win.
   */
  private async transition(current: Appointment, action: AppointmentAction, changes: Partial<Appointment>) {
    const [updated] = await this.db
      .update(appointments)
      .set(changes)
      .where(
        and(
          eq(appointments.clinicId, current.clinicId),
          eq(appointments.id, current.id),
          inArray(appointments.status, [...allowedFrom(action)]),
        ),
      )
      .returning();
    if (!updated) {
      throw new ConflictException('A sessão foi alterada por outra pessoa. Atualize e tente de novo.');
    }
    return updated;
  }

  /** Every rule a slot must pass, with clear messages, before the database's final check. */
  private async validateSlot(tx: Executor, slot: Slot) {
    const now = this.clock.now();
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw new UnprocessableEntityException('A sessão precisa começar no futuro.');
    }
    const [clinic] = await tx.select().from(clinics).where(eq(clinics.id, slot.clinicId));
    const [type] = await tx
      .select()
      .from(sessionTypes)
      .where(and(eq(sessionTypes.clinicId, slot.clinicId), eq(sessionTypes.id, slot.sessionTypeId), eq(sessionTypes.active, true)));
    if (!type) {
      throw new UnprocessableEntityException('Tipo de sessão não encontrado ou inativo.');
    }
    if (slot.mode === 'in_person') {
      if (!slot.roomId) {
        throw new UnprocessableEntityException('Sessão presencial precisa de uma sala.');
      }
      const [room] = await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.clinicId, slot.clinicId), eq(rooms.id, slot.roomId), eq(rooms.active, true)));
      if (!room) {
        throw new UnprocessableEntityException('Sala não encontrada ou inativa.');
      }
    } else if (slot.roomId) {
      throw new UnprocessableEntityException('Sessão online não usa sala.');
    }

    const startsAt = slot.startsAt;
    const endsAt = new Date(startsAt.getTime() + type.durationMinutes * 60_000);
    const blockedUntil = new Date(endsAt.getTime() + clinic.bufferMinutes * 60_000);

    const ranges = await tx
      .select()
      .from(workingHours)
      .where(and(eq(workingHours.clinicId, slot.clinicId), eq(workingHours.psychologistId, slot.psychologistId)));
    if (!fitsWorkingHours(startsAt, endsAt, clinic.timezone, ranges)) {
      throw new UnprocessableEntityException('Fora do horário de trabalho do psicólogo.');
    }
    const [absence] = await tx
      .select({ id: timeOff.id })
      .from(timeOff)
      .where(
        and(
          eq(timeOff.clinicId, slot.clinicId),
          eq(timeOff.psychologistId, slot.psychologistId),
          lt(timeOff.startsAt, endsAt),
          gt(timeOff.endsAt, startsAt),
        ),
      );
    if (absence) {
      throw new UnprocessableEntityException('O psicólogo estará ausente neste horário.');
    }

    const conflicts = await this.findConflicts(tx, slot, startsAt, endsAt, blockedUntil);
    if (conflicts.length) {
      throw new ConflictException({ statusCode: 409, message: conflictMessage(conflicts[0].reason), conflicts });
    }
    return { startsAt, endsAt, blockedUntil };
  }

  /** The same overlap rules as the exclusion constraints, to explain what is in the way. */
  private async findConflicts(tx: Executor, slot: Slot, startsAt: Date, endsAt: Date, blockedUntil: Date): Promise<Conflict[]> {
    const base = [
      eq(appointments.clinicId, slot.clinicId),
      inArray(appointments.status, [...BLOCKING_STATUSES]),
      ...(slot.excludeId ? [ne(appointments.id, slot.excludeId)] : []),
    ];
    const blockedOverlap = and(lt(appointments.startsAt, blockedUntil), gt(appointments.blockedUntil, startsAt));
    const select = { startsAt: appointments.startsAt, endsAt: appointments.endsAt };

    const [byPsychologist, byRoom, byPatient] = await Promise.all([
      tx.select(select).from(appointments).where(and(...base, eq(appointments.psychologistId, slot.psychologistId), blockedOverlap)),
      slot.roomId
        ? tx.select(select).from(appointments).where(and(...base, eq(appointments.roomId, slot.roomId), blockedOverlap))
        : Promise.resolve([]),
      tx
        .select(select)
        .from(appointments)
        .where(and(...base, eq(appointments.patientId, slot.patientId), lt(appointments.startsAt, endsAt), gt(appointments.endsAt, startsAt))),
    ]);
    return [
      ...byPsychologist.map((c) => ({ reason: 'psychologist' as const, ...c })),
      ...byRoom.map((c) => ({ reason: 'room' as const, ...c })),
      ...byPatient.map((c) => ({ reason: 'patient' as const, ...c })),
    ];
  }

  private async find(id: string): Promise<Appointment> {
    const [row] = await this.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.clinicId, this.tenant.clinicId()), eq(appointments.id, id)));
    if (!row) {
      throw new NotFoundException();
    }
    return row;
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

  private async present(
    user: User,
    row: { appointment: Appointment; patientName: string; psychologistName: string; sessionTypeName: string; roomName: string | null },
  ) {
    const { appointment: a } = row;
    const visible = await this.authz.can(AppointmentPolicy, 'seePatient', user, a.psychologistId);
    return {
      id: a.id,
      psychologistId: a.psychologistId,
      psychologistName: row.psychologistName,
      roomId: a.roomId,
      roomName: row.roomName,
      mode: a.mode,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      status: a.status,
      // Colleagues' sessions are opaque to a psychologist: busy, nothing more.
      restricted: !visible,
      patientId: visible ? a.patientId : null,
      patientName: visible ? row.patientName : null,
      sessionTypeName: visible ? row.sessionTypeName : null,
    };
  }
}

export function conflictMessage(reason: Conflict['reason']): string {
  return {
    psychologist: 'O psicólogo já tem uma sessão neste horário (considerando o intervalo entre sessões).',
    room: 'A sala já está ocupada neste horário.',
    patient: 'O paciente já tem uma sessão neste horário.',
  }[reason];
}
