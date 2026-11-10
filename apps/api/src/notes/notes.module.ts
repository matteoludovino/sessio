import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  InternalServerErrorException,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appointments } from '../appointments/appointments.schema.js';
import { AuditService } from '../audit/audit.module.js';
import type { User } from '../auth/user.js';
import { uuidParam } from '../common/schemas.js';
import type { Env } from '../config/env.js';
import type { Database } from '../db/db.module.js';
import { patients } from '../patients/patients.schema.js';
import { Tenant } from '../tenancy/tenant.js';
import { NoteCipher, NoteIntegrityError, noteAad } from './note-cipher.js';
import { type ClinicalNote, clinicalNotes } from './notes.schema.js';

const createNote = z.object({
  content: z.string().trim().min(1).max(20_000),
  appointmentId: z.uuid().optional(),
  amendsNoteId: z.uuid().optional(),
});
type CreateNote = z.infer<typeof createNote>;

/**
 * The clinical record. Rules:
 * - Only the psychologist who wrote a note reads it; owner and reception never do (403), and a
 *   colleague's notes are invisible (404). Every access, allowed or denied, is audited.
 * - New notes only for one's current patients; one's own past notes stay readable after a
 *   patient changes psychologist, and stay with their author.
 * - Append-only: corrections are addenda.
 */
@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);
  private readonly cipher: NoteCipher;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.cipher = new NoteCipher(config.get('NOTES_ENCRYPTION_KEYS', { infer: true }));
  }

  async list(patientId: string) {
    const user = await this.requirePsychologist('note.list', patientId);
    const patient = await this.findPatient(patientId);
    const rows = await this.db
      .select()
      .from(clinicalNotes)
      .where(and(eq(clinicalNotes.clinicId, user.clinicId), eq(clinicalNotes.patientId, patientId), eq(clinicalNotes.authorId, user.id)))
      .orderBy(asc(clinicalNotes.createdAt));
    // Neither their patient now nor one they wrote about: not visible.
    if (!patient || (patient.psychologistId !== user.id && rows.length === 0)) {
      await this.deny(user, 'note.list', null, patientId);
      throw new NotFoundException();
    }
    await this.audit.record({ ...this.actor(user), action: 'note.list', resourceType: 'patient', resourceId: patientId, patientId, outcome: 'allowed', metadata: { count: rows.length } });
    return rows.map((row) => this.present(row));
  }

  async get(id: string) {
    const user = await this.requirePsychologist('note.read', null);
    const [row] = await this.db.select().from(clinicalNotes).where(and(eq(clinicalNotes.clinicId, user.clinicId), eq(clinicalNotes.id, id)));
    if (!row || row.authorId !== user.id) {
      await this.deny(user, 'note.read', id, row?.patientId ?? null);
      throw new NotFoundException();
    }
    await this.audit.record({ ...this.actor(user), action: 'note.read', resourceType: 'clinical_note', resourceId: id, patientId: row.patientId, outcome: 'allowed' });
    return this.present(row);
  }

  async create(patientId: string, dto: CreateNote) {
    const user = await this.requirePsychologist('note.create', patientId);
    const patient = await this.findPatient(patientId);
    if (!patient || patient.psychologistId !== user.id) {
      await this.deny(user, 'note.create', null, patientId);
      throw new NotFoundException();
    }
    if (dto.appointmentId) {
      const [appointment] = await this.db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.id, dto.appointmentId), eq(appointments.patientId, patientId), eq(appointments.psychologistId, user.id)));
      if (!appointment) throw new UnprocessableEntityException('A sessão informada não é deste paciente com você.');
    }
    if (dto.amendsNoteId) {
      const [original] = await this.db
        .select({ id: clinicalNotes.id })
        .from(clinicalNotes)
        .where(and(eq(clinicalNotes.id, dto.amendsNoteId), eq(clinicalNotes.patientId, patientId), eq(clinicalNotes.authorId, user.id)));
      if (!original) throw new UnprocessableEntityException('A nota a complementar não foi encontrada.');
    }
    const id = randomUUID(); // known before encrypting: the ciphertext is bound to it
    const binding = { id, clinicId: user.clinicId, patientId, authorId: user.id };
    const encrypted = this.cipher.encrypt(dto.content, noteAad(binding));
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(clinicalNotes)
        .values({ ...binding, ...encrypted, appointmentId: dto.appointmentId ?? null, amendsNoteId: dto.amendsNoteId ?? null })
        .returning();
      await this.audit.record({ ...this.actor(user), action: 'note.create', resourceType: 'clinical_note', resourceId: id, patientId, outcome: 'allowed' }, tx);
      return created;
    });
    return this.present(row);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Checked here, not on the route, so that a denied attempt is audited before the 403. */
  private async requirePsychologist(action: string, patientId: string | null): Promise<User> {
    const user = this.tenant.user();
    if (user.role !== 'psychologist') {
      await this.deny(user, action, null, patientId);
      throw new ForbiddenException('O prontuário é restrito ao psicólogo que o escreveu.');
    }
    return user;
  }

  private async deny(user: User, action: string, resourceId: string | null, patientId: string | null) {
    await this.audit.record({ ...this.actor(user), action, resourceType: 'clinical_note', resourceId, patientId, outcome: 'denied' });
  }

  private actor(user: User) {
    return { clinicId: user.clinicId, actorId: user.id };
  }

  private async findPatient(id: string) {
    const [patient] = await this.db
      .select({ id: patients.id, psychologistId: patients.psychologistId })
      .from(patients)
      .where(and(eq(patients.clinicId, this.tenant.clinicId()), eq(patients.id, id)));
    return patient;
  }

  private present(row: ClinicalNote) {
    let content: string;
    try {
      content = this.cipher.decrypt(row, noteAad(row));
    } catch (error) {
      if (error instanceof NoteIntegrityError) {
        // Never served, never silently skipped: someone changed the database or lost a key.
        this.logger.error(`Clinical note ${row.id} failed authentication: ${error.message}`);
        throw new InternalServerErrorException('Falha de integridade no prontuário. Contate o suporte.');
      }
      throw error;
    }
    return {
      id: row.id,
      patientId: row.patientId,
      authorId: row.authorId,
      appointmentId: row.appointmentId,
      amendsNoteId: row.amendsNoteId,
      content,
      createdAt: row.createdAt,
    };
  }
}

/** Routes accept any signed-in user; the service decides and audits (see requirePsychologist). */
@Controller()
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get('patients/:id/notes')
  @Can.Anyone()
  list(@Param('id', { schema: uuidParam }) patientId: string) {
    return this.notes.list(patientId);
  }

  @Post('patients/:id/notes')
  @Can.Anyone()
  create(@Param('id', { schema: uuidParam }) patientId: string, @Body({ schema: createNote }) body: CreateNote) {
    return this.notes.create(patientId, body);
  }

  @Get('notes/:id')
  @Can.Anyone()
  get(@Param('id', { schema: uuidParam }) id: string) {
    return this.notes.get(id);
  }
}

@Module({ controllers: [NotesController], providers: [NotesService] })
export class NotesModule {}
