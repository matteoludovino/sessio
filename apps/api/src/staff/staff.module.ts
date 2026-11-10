import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InvitationsService } from './invitations.service.js';
import { StaffInvitationMail } from './staff-invitation.mail.js';
import { StaffController } from './staff.controller.js';
import { StaffPolicy } from './staff.policy.js';
import { StaffService } from './staff.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StaffController],
  providers: [StaffService, InvitationsService, StaffPolicy, StaffInvitationMail],
})
export class StaffModule {}
