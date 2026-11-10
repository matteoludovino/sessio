import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { Policy } from '@nestjs/authorization';
import { InjectDrizzle } from '@nestjs/drizzle';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { User } from '../auth/user.js';
import type { Database } from '../db/db.module.js';
import { StaffInvitationMail } from '../staff/staff-invitation.mail.js';
import { Tenant } from '../tenancy/tenant.js';
import { LinkTokens } from './link-tokens.js';
import { NotificationHandlers } from './notification.handlers.js';
import { sentNotifications } from './notifications.schema.js';
import { ReminderMail } from './reminder.mail.js';
import { ReminderScheduler } from './reminder.scheduler.js';

@Policy()
export class NotificationPolicy {
  /** The front desk follows what was sent; it carries patients' contact details. */
  view(user: User | null) {
    return user?.role === 'owner' || user?.role === 'reception';
  }
}

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

@Injectable()
export class NotificationsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
  ) {}

  list(limit: number) {
    return this.db
      .select()
      .from(sentNotifications)
      .where(eq(sentNotifications.clinicId, this.tenant.clinicId()))
      .orderBy(desc(sentNotifications.sentAt))
      .limit(limit);
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** In demo mode each entry carries the mail's HTML: the in-app outbox. */
  @Get()
  @Can(NotificationPolicy, 'view')
  list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return this.notifications.list(query.limit);
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationPolicy, NotificationHandlers, ReminderScheduler, ReminderMail, StaffInvitationMail, LinkTokens],
  exports: [ReminderScheduler, LinkTokens],
})
export class NotificationsModule {}
