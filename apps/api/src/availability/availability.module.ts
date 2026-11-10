import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { uuidParam } from '../common/schemas.js';
import type { Database } from '../db/db.module.js';
import { Tenant } from '../tenancy/tenant.js';
import { users } from '../users/users.schema.js';
import { AvailabilityPolicy } from './availability.policy.js';
import { timeOff, workingHours } from './availability.schema.js';
import { hhmm, toHHMM } from './time.js';

const range = z
  .object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm })
  .refine((r) => r.start < r.end, { message: 'O início deve ser antes do fim.' });
const putWorkingHours = z.object({ ranges: z.array(range).max(50) });
const createTimeOff = z
  .object({
    startsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    endsAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((t) => t.startsAt < t.endsAt, { message: 'O início deve ser antes do fim.' });
const timeOffQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

const psychologistParam = (ctx: { switchToHttp(): { getRequest<T>(): T } }): [string] => [
  ctx.switchToHttp().getRequest<Request>().params.id as string,
];

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
  ) {}

  listPsychologists() {
    return this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.clinicId, this.tenant.clinicId()), eq(users.role, 'psychologist'), eq(users.active, true)))
      .orderBy(asc(users.name));
  }

  async getWorkingHours(psychologistId: string) {
    await this.assertPsychologist(psychologistId);
    const rows = await this.db
      .select()
      .from(workingHours)
      .where(and(eq(workingHours.clinicId, this.tenant.clinicId()), eq(workingHours.psychologistId, psychologistId)))
      .orderBy(asc(workingHours.weekday), asc(workingHours.startMinute));
    return rows.map((r) => ({ weekday: r.weekday, start: toHHMM(r.startMinute), end: toHHMM(r.endMinute) }));
  }

  /**
   * Replaces the whole week atomically: the schedule is never seen half-written.
   * Replacements of one psychologist's week are serialized by locking their user row first:
   * without it, concurrent delete+insert transactions wait on each other's rows through the
   * exclusion constraint and deadlock (found by the concurrency e2e test).
   */
  async replaceWorkingHours(psychologistId: string, ranges: z.infer<typeof range>[]) {
    await this.assertPsychologist(psychologistId);
    assertNoOverlap(ranges);
    const clinicId = this.tenant.clinicId();
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.clinicId, clinicId), eq(users.id, psychologistId)))
        .for('update');
      await tx
        .delete(workingHours)
        .where(and(eq(workingHours.clinicId, clinicId), eq(workingHours.psychologistId, psychologistId)));
      if (ranges.length) {
        await tx.insert(workingHours).values(
          ranges.map((r) => ({ clinicId, psychologistId, weekday: r.weekday, startMinute: r.start, endMinute: r.end })),
        );
      }
    });
    return this.getWorkingHours(psychologistId);
  }

  async listTimeOff(psychologistId: string, { from, to }: z.infer<typeof timeOffQuery>) {
    await this.assertPsychologist(psychologistId);
    const conditions = [eq(timeOff.clinicId, this.tenant.clinicId()), eq(timeOff.psychologistId, psychologistId)];
    if (from) conditions.push(gt(timeOff.endsAt, new Date(from)));
    if (to) conditions.push(lt(timeOff.startsAt, new Date(to)));
    return this.db
      .select()
      .from(timeOff)
      .where(and(...conditions))
      .orderBy(asc(timeOff.startsAt));
  }

  /** Overlapping absences are refused by the database (time_off_no_overlap). */
  async addTimeOff(psychologistId: string, dto: z.infer<typeof createTimeOff>) {
    await this.assertPsychologist(psychologistId);
    const [row] = await this.db
      .insert(timeOff)
      .values({ clinicId: this.tenant.clinicId(), psychologistId, ...dto })
      .returning();
    return row;
  }

  async removeTimeOff(psychologistId: string, id: string) {
    const deleted = await this.db
      .delete(timeOff)
      .where(and(eq(timeOff.clinicId, this.tenant.clinicId()), eq(timeOff.psychologistId, psychologistId), eq(timeOff.id, id)))
      .returning({ id: timeOff.id });
    if (!deleted.length) {
      throw new NotFoundException();
    }
  }

  private async assertPsychologist(id: string) {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clinicId, this.tenant.clinicId()), eq(users.id, id), eq(users.role, 'psychologist')));
    if (!row) {
      throw new NotFoundException();
    }
  }
}

/** A clear message before the database's exclusion constraint has to step in. */
function assertNoOverlap(ranges: { weekday: number; start: number; end: number }[]) {
  const sorted = [...ranges].sort((a, b) => a.weekday - b.weekday || a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.weekday === cur.weekday && cur.start < prev.end) {
      throw new BadRequestException('Os horários de trabalho se sobrepõem.');
    }
  }
}

@Controller('psychologists')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @Can(AvailabilityPolicy, 'view')
  list() {
    return this.availability.listPsychologists();
  }

  @Get(':id/working-hours')
  @Can(AvailabilityPolicy, 'view')
  getWorkingHours(@Param('id', { schema: uuidParam }) id: string) {
    return this.availability.getWorkingHours(id);
  }

  @Put(':id/working-hours')
  @Can(AvailabilityPolicy, 'manage', psychologistParam)
  putWorkingHours(@Param('id', { schema: uuidParam }) id: string, @Body({ schema: putWorkingHours }) body: z.infer<typeof putWorkingHours>) {
    return this.availability.replaceWorkingHours(id, body.ranges);
  }

  @Get(':id/time-off')
  @Can(AvailabilityPolicy, 'view')
  listTimeOff(@Param('id', { schema: uuidParam }) id: string, @Query({ schema: timeOffQuery }) query: z.infer<typeof timeOffQuery>) {
    return this.availability.listTimeOff(id, query);
  }

  @Post(':id/time-off')
  @Can(AvailabilityPolicy, 'manage', psychologistParam)
  addTimeOff(@Param('id', { schema: uuidParam }) id: string, @Body({ schema: createTimeOff }) body: z.infer<typeof createTimeOff>) {
    return this.availability.addTimeOff(id, body);
  }

  @Delete(':id/time-off/:timeOffId')
  @HttpCode(204)
  @Can(AvailabilityPolicy, 'manage', psychologistParam)
  removeTimeOff(@Param('id', { schema: uuidParam }) id: string, @Param('timeOffId', { schema: uuidParam }) timeOffId: string) {
    return this.availability.removeTimeOff(id, timeOffId);
  }
}

@Module({ controllers: [AvailabilityController], providers: [AvailabilityService, AvailabilityPolicy], exports: [AvailabilityService] })
export class AvailabilityModule {}
