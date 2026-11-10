import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthorizationService } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { aliasedTable, and, asc, eq, gt, inArray, lt, type SQL } from 'drizzle-orm';
import type { User } from '../auth/user.js';
import { clinics } from '../clinics/clinics.schema.js';
import { Clock } from '../common/clock.js';
import type { Database } from '../db/db.module.js';
import { patients } from '../patients/patients.schema.js';
import { rooms } from '../rooms/rooms.schema.js';
import { sessionTypes } from '../session-types/session-types.schema.js';
import { Tenant } from '../tenancy/tenant.js';
import { users } from '../users/users.schema.js';
import { type AppointmentAction, allowedFrom, assertCan, cancellationStatus, RuleViolation } from './appointment-rules.js';
import { AppointmentPolicy } from './appointment.policy.js';
import type { CancelDto, CreateAppointmentDto, ListQuery, RescheduleDto } from './appointments.schemas.js';
import { type Appointment, appointments } from './appointments.schema.js';
import { type SlotRequest, SlotValidator } from './slot-validator.js';

const psychologist = aliasedTable(users, 'psychologist');

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
    private readonly authz: AuthorizationService,
    private readonly clock: Clock,
    private readonly slots: SlotValidator,
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

    const request: SlotRequest = {
      clinicId: user.clinicId,
      psychologistId: patient.psychologistId,
      patientId: patient.id,
      sessionTypeId: dto.sessionTypeId,
      mode: dto.mode,
      roomId: dto.roomId ?? null,
    };
    const times = await this.slots.validate(this.db, request, dto.startsAt);
    // The database's exclusion constraints make the final call, also between racing requests.
    const [created] = await this.db
      .insert(appointments)
      .values({ ...request, ...times, createdBy: user.id })
      .returning();
    return created;
  }

  /** Moves the session; it goes back to "scheduled" because the patient must confirm the new time. */
  async reschedule(id: string, dto: RescheduleDto) {
    const current = await this.get(id);
    this.check('reschedule', current);
    const mode = dto.mode ?? current.mode;
    const roomId = mode === 'online' ? null : dto.roomId !== undefined ? dto.roomId : current.roomId;
    const times = await this.slots.validate(this.db, { ...current, mode, roomId, excludeId: current.id }, dto.startsAt);
    return this.transition(current, 'reschedule', {
      ...times,
      mode,
      roomId,
      status: 'scheduled',
      // The new time gets its own reminder (and old links stop working).
      reminderQueuedFor: null,
      reminderSentAt: null,
    });
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

  /** 422 with the rule's message when the action isn't allowed on this appointment now. */
  check(action: AppointmentAction, appointment: Appointment) {
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
      seriesId: visible ? a.seriesId : null,
      // Colleagues' sessions are opaque to a psychologist: busy, nothing more.
      restricted: !visible,
      patientId: visible ? a.patientId : null,
      patientName: visible ? row.patientName : null,
      sessionTypeName: visible ? row.sessionTypeName : null,
    };
  }
}
