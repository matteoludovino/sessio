import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Public, SignInService } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { User } from '../auth/user.js';
import { InvitationsService } from './invitations.service.js';
import { StaffPolicy } from './staff.policy.js';
import {
  type AcceptInvitationDto,
  acceptInvitationSchema,
  idParam,
  type InviteDto,
  inviteSchema,
  type UpdateStaffDto,
  updateStaffSchema,
} from './staff.schemas.js';
import { StaffService } from './staff.service.js';

@Controller()
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly invitations: InvitationsService,
    private readonly signInService: SignInService,
  ) {}

  @Get('staff')
  @Can(StaffPolicy, 'list')
  list() {
    return this.staff.list();
  }

  @Patch('staff/:id')
  @Can(StaffPolicy, 'update')
  update(@Param('id', { schema: idParam }) id: string, @Body({ schema: updateStaffSchema }) body: UpdateStaffDto) {
    return this.staff.update(id, body);
  }

  @Post('staff/invitations')
  @Can(StaffPolicy, 'invite')
  invite(@Body({ schema: inviteSchema }) body: InviteDto) {
    return this.invitations.invite(body);
  }

  /** The invitee sets a password and is signed in. */
  @Public()
  @Post('invitations/accept')
  @HttpCode(200)
  async accept(@Body({ schema: acceptInvitationSchema }) body: AcceptInvitationDto): Promise<User> {
    const user = await this.invitations.accept(body);
    await this.signInService.signIn(user.id, { method: 'invitation' });
    return user;
  }
}
