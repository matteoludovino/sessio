import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ClinicConfigPolicy } from '../common/clinic-config.policy.js';
import { name, queryBool, uuidParam } from '../common/schemas.js';
import type { Database } from '../db/db.module.js';
import { Tenant } from '../tenancy/tenant.js';
import { rooms } from './rooms.schema.js';

const createRoom = z.object({ name });
const updateRoom = z.object({ name: name.optional(), active: z.boolean().optional() });
const listQuery = z.object({ includeInactive: queryBool.optional() });

@Injectable()
export class RoomsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
  ) {}

  list(includeInactive = false) {
    const clinicId = this.tenant.clinicId();
    return this.db
      .select()
      .from(rooms)
      .where(includeInactive ? eq(rooms.clinicId, clinicId) : and(eq(rooms.clinicId, clinicId), eq(rooms.active, true)))
      .orderBy(asc(rooms.name));
  }

  async create(dto: z.infer<typeof createRoom>) {
    const [room] = await this.db.insert(rooms).values({ clinicId: this.tenant.clinicId(), name: dto.name }).returning();
    return room;
  }

  /** Deactivated rooms keep their history; new in-person sessions can't use them (stage 4). */
  async update(id: string, dto: z.infer<typeof updateRoom>) {
    const [room] = await this.db
      .update(rooms)
      .set(dto)
      .where(and(eq(rooms.clinicId, this.tenant.clinicId()), eq(rooms.id, id)))
      .returning();
    if (!room) {
      throw new NotFoundException();
    }
    return room;
  }
}

@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @Can(ClinicConfigPolicy, 'view')
  list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return this.rooms.list(query.includeInactive);
  }

  @Post()
  @Can(ClinicConfigPolicy, 'manage')
  create(@Body({ schema: createRoom }) body: z.infer<typeof createRoom>) {
    return this.rooms.create(body);
  }

  @Patch(':id')
  @Can(ClinicConfigPolicy, 'manage')
  update(@Param('id', { schema: uuidParam }) id: string, @Body({ schema: updateRoom }) body: z.infer<typeof updateRoom>) {
    return this.rooms.update(id, body);
  }
}

@Module({ controllers: [RoomsController], providers: [RoomsService, ClinicConfigPolicy] })
export class RoomsModule {}
