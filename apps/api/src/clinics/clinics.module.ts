import { Body, Controller, Get, Injectable, Module, Patch } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ClinicConfigPolicy } from '../common/clinic-config.policy.js';
import { name } from '../common/schemas.js';
import type { Database } from '../db/db.module.js';
import { Tenant } from '../tenancy/tenant.js';
import { clinics } from './clinics.schema.js';

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Fuso horário inválido');

const updateClinic = z
  .object({
    name: name.optional(),
    timezone: timezone.optional(),
    lateCancelHours: z.number().int().min(0).max(168).optional(),
    bufferMinutes: z.number().int().min(0).max(60).optional(),
    reminderLeadHours: z.number().int().min(2).max(168).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

@Injectable()
export class ClinicsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
  ) {}

  async get() {
    const [clinic] = await this.db.select().from(clinics).where(eq(clinics.id, this.tenant.clinicId()));
    return clinic;
  }

  /** New buffer and deadlines apply to sessions booked or cancelled from now on. */
  async update(dto: z.infer<typeof updateClinic>) {
    const [clinic] = await this.db.update(clinics).set(dto).where(eq(clinics.id, this.tenant.clinicId())).returning();
    return clinic;
  }
}

@Controller('clinic')
export class ClinicsController {
  constructor(private readonly clinics: ClinicsService) {}

  @Get()
  @Can(ClinicConfigPolicy, 'view')
  get() {
    return this.clinics.get();
  }

  @Patch()
  @Can(ClinicConfigPolicy, 'manage')
  update(@Body({ schema: updateClinic }) body: z.infer<typeof updateClinic>) {
    return this.clinics.update(body);
  }
}

@Module({ controllers: [ClinicsController], providers: [ClinicsService, ClinicConfigPolicy] })
export class ClinicsModule {}
