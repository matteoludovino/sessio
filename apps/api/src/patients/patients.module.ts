import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthorizationService, Can } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { name, queryBool, uuidParam } from '../common/schemas.js';
import type { Database } from '../db/db.module.js';
import { Tenant } from '../tenancy/tenant.js';
import { normalizeEmail } from '../users/users.repository.js';
import { users } from '../users/users.schema.js';
import { PatientPolicy } from './patient.policy.js';
import { patients } from './patients.schema.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const patientFields = {
  name,
  // Normalized before validating, so ' Ana@Example.com ' is accepted as ana@example.com.
  email: z.string().transform(normalizeEmail).pipe(z.email()).nullable().optional(),
  phone: optionalText(30),
  birthDate: z.iso.date().nullable().optional(),
};
const createPatient = z.object({ ...patientFields, psychologistId: z.uuid().optional() });
const updatePatient = z.object({
  ...patientFields,
  name: name.optional(),
  psychologistId: z.uuid().optional(),
  active: z.boolean().optional(),
});
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  includeArchived: queryBool.optional(),
});
type CreatePatient = z.infer<typeof createPatient>;
type UpdatePatient = z.infer<typeof updatePatient>;

/** LIKE wildcards typed by the user are literal characters, not patterns. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class PatientsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
    private readonly authz: AuthorizationService,
  ) {}

  /** Psychologists list only their own patients. */
  list({ q, includeArchived }: z.infer<typeof listQuery>) {
    const user = this.tenant.user();
    const conditions: SQL[] = [eq(patients.clinicId, user.clinicId)];
    if (user.role === 'psychologist') {
      conditions.push(eq(patients.psychologistId, user.id));
    }
    if (!includeArchived) {
      conditions.push(eq(patients.active, true));
    }
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(or(ilike(patients.name, pattern), ilike(patients.email, pattern))!);
    }
    return this.db
      .select()
      .from(patients)
      .where(and(...conditions))
      .orderBy(asc(patients.name))
      .limit(200);
  }

  /** Not visible to this user = not found: a 404 doesn't confirm the patient exists. */
  async get(id: string) {
    const user = this.tenant.user();
    const [patient] = await this.db
      .select()
      .from(patients)
      .where(and(eq(patients.clinicId, user.clinicId), eq(patients.id, id)));
    if (!patient || !(await this.authz.can(PatientPolicy, 'view', user, patient))) {
      throw new NotFoundException();
    }
    return patient;
  }

  async create(dto: CreatePatient) {
    const user = this.tenant.user();
    // A psychologist registers patients for themselves; the front desk picks the psychologist.
    const psychologistId = user.role === 'psychologist' ? user.id : dto.psychologistId;
    if (!psychologistId) {
      throw new UnprocessableEntityException('Informe o psicólogo responsável.');
    }
    if (user.role === 'psychologist' && dto.psychologistId && dto.psychologistId !== user.id) {
      await this.authz.authorize(PatientPolicy, 'reassign', user);
    }
    await this.assertPsychologist(psychologistId);
    const [patient] = await this.db
      .insert(patients)
      .values({ ...dto, clinicId: user.clinicId, psychologistId })
      .returning();
    return patient;
  }

  async update(id: string, dto: UpdatePatient) {
    const user = this.tenant.user();
    const patient = await this.get(id);
    await this.authz.authorize(PatientPolicy, 'update', user, patient);
    if (dto.active !== undefined && dto.active !== patient.active) {
      await this.authz.authorize(PatientPolicy, 'archive', user);
    }
    if (dto.psychologistId && dto.psychologistId !== patient.psychologistId) {
      await this.authz.authorize(PatientPolicy, 'reassign', user);
      await this.assertPsychologist(dto.psychologistId);
    }
    const [updated] = await this.db
      .update(patients)
      .set(dto)
      .where(and(eq(patients.clinicId, user.clinicId), eq(patients.id, id)))
      .returning();
    return updated;
  }

  /** The composite FK guarantees the clinic; the role and the account status are checked here. */
  private async assertPsychologist(id: string) {
    const [psychologist] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.clinicId, this.tenant.clinicId()), eq(users.id, id), eq(users.role, 'psychologist'), eq(users.active, true)),
      );
    if (!psychologist) {
      throw new UnprocessableEntityException('Psicólogo não encontrado nesta clínica.');
    }
  }
}

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @Can(PatientPolicy, 'access')
  list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return this.patients.list(query);
  }

  @Get(':id')
  @Can(PatientPolicy, 'access')
  get(@Param('id', { schema: uuidParam }) id: string) {
    return this.patients.get(id);
  }

  @Post()
  @Can(PatientPolicy, 'access')
  create(@Body({ schema: createPatient }) body: CreatePatient) {
    return this.patients.create(body);
  }

  @Patch(':id')
  @Can(PatientPolicy, 'access')
  update(@Param('id', { schema: uuidParam }) id: string, @Body({ schema: updatePatient }) body: UpdatePatient) {
    return this.patients.update(id, body);
  }
}

@Module({ controllers: [PatientsController], providers: [PatientsService, PatientPolicy], exports: [PatientsService] })
export class PatientsModule {}
