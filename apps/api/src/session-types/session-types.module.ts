import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ClinicConfigPolicy } from '../common/clinic-config.policy.js';
import { name, queryBool, uuidParam } from '../common/schemas.js';
import type { Database } from '../db/db.module.js';
import { Tenant } from '../tenancy/tenant.js';
import { sessionTypes } from './session-types.schema.js';

const durationMinutes = z.number().int().min(15).max(240);
const createType = z.object({ name, durationMinutes });
const updateType = z.object({ name: name.optional(), durationMinutes: durationMinutes.optional(), active: z.boolean().optional() });
const listQuery = z.object({ includeInactive: queryBool.optional() });

@Injectable()
export class SessionTypesService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
  ) {}

  list(includeInactive = false) {
    const clinicId = this.tenant.clinicId();
    return this.db
      .select()
      .from(sessionTypes)
      .where(
        includeInactive
          ? eq(sessionTypes.clinicId, clinicId)
          : and(eq(sessionTypes.clinicId, clinicId), eq(sessionTypes.active, true)),
      )
      .orderBy(asc(sessionTypes.name));
  }

  async create(dto: z.infer<typeof createType>) {
    const [type] = await this.db
      .insert(sessionTypes)
      .values({ clinicId: this.tenant.clinicId(), ...dto })
      .returning();
    return type;
  }

  /** A new duration applies to sessions booked from now on; existing ones keep their times. */
  async update(id: string, dto: z.infer<typeof updateType>) {
    const [type] = await this.db
      .update(sessionTypes)
      .set(dto)
      .where(and(eq(sessionTypes.clinicId, this.tenant.clinicId()), eq(sessionTypes.id, id)))
      .returning();
    if (!type) {
      throw new NotFoundException();
    }
    return type;
  }
}

@Controller('session-types')
export class SessionTypesController {
  constructor(private readonly types: SessionTypesService) {}

  @Get()
  @Can(ClinicConfigPolicy, 'view')
  list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return this.types.list(query.includeInactive);
  }

  @Post()
  @Can(ClinicConfigPolicy, 'manage')
  create(@Body({ schema: createType }) body: z.infer<typeof createType>) {
    return this.types.create(body);
  }

  @Patch(':id')
  @Can(ClinicConfigPolicy, 'manage')
  update(@Param('id', { schema: uuidParam }) id: string, @Body({ schema: updateType }) body: z.infer<typeof updateType>) {
    return this.types.update(id, body);
  }
}

@Module({ controllers: [SessionTypesController], providers: [SessionTypesService, ClinicConfigPolicy] })
export class SessionTypesModule {}
