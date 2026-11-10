import { Controller, Get, Global, Injectable, Module, Query } from '@nestjs/common';
import { Can, Policy } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { User } from '../auth/user.js';
import type { Database, Executor } from '../db/db.module.js';
import { Tenant } from '../tenancy/tenant.js';
import { users } from '../users/users.schema.js';
import { auditEvents } from './audit.schema.js';

export interface AuditEntry {
  clinicId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  outcome: 'allowed' | 'denied';
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
  ) {}

  /** Pass the transaction of the action, so the record commits (or rolls back) with it. */
  async record(entry: AuditEntry, tx: Executor = this.db): Promise<void> {
    await tx.insert(auditEvents).values(entry);
  }

  list({ patientId, limit }: { patientId?: string; limit: number }) {
    const conditions: SQL[] = [eq(auditEvents.clinicId, this.tenant.clinicId())];
    if (patientId) conditions.push(eq(auditEvents.patientId, patientId));
    return this.db
      .select({
        id: auditEvents.id,
        at: auditEvents.at,
        action: auditEvents.action,
        outcome: auditEvents.outcome,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        patientId: auditEvents.patientId,
        actorId: auditEvents.actorId,
        actorName: users.name,
        actorRole: users.role,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(and(...conditions))
      .orderBy(desc(auditEvents.at))
      .limit(limit);
  }
}

@Policy()
export class AuditPolicy {
  /** The owner answers for the clinic: sees who accessed what, never the content itself. */
  view(user: User | null) {
    return user?.role === 'owner';
  }
}

const listQuery = z.object({
  patientId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Can(AuditPolicy, 'view')
  list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return this.audit.list(query);
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService, AuditPolicy], exports: [AuditService] })
export class AuditModule {}
