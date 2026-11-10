import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DEMO_ACCOUNT_EMAILS } from '../demo/demo-data.js';
import { Tenant } from '../tenancy/tenant.js';
import { UsersRepository } from '../users/users.repository.js';
import type { UpdateStaffDto } from './staff.schemas.js';

@Injectable()
export class StaffService {
  constructor(
    private readonly tenant: Tenant,
    private readonly usersRepository: UsersRepository,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  list() {
    return this.usersRepository.listByClinic(this.tenant.clinicId());
  }

  async update(id: string, dto: UpdateStaffDto) {
    const clinicId = this.tenant.clinicId();
    const target = await this.usersRepository.findInClinic(clinicId, id);
    if (!target) {
      throw new NotFoundException();
    }
    // Visitors share the demo accounts: one of them must not lock the others out.
    if (this.config.get('DEMO_MODE', { infer: true }) && DEMO_ACCOUNT_EMAILS.has(target.email) && (dto.active !== undefined || dto.role !== undefined)) {
      throw new BadRequestException('As contas de demonstração não podem ser desativadas nem mudar de papel.');
    }
    const losesOwnership = target.role === 'owner' && target.active && (dto.active === false || (dto.role && dto.role !== 'owner'));
    if (losesOwnership && (await this.usersRepository.countActiveOwners(clinicId)) <= 1) {
      throw new BadRequestException('A clínica precisa de pelo menos um proprietário ativo.');
    }
    const updated = await this.usersRepository.updateInClinic(clinicId, id, dto);
    if (dto.active === false) {
      // Deactivation signs the person out everywhere, immediately.
      await this.sessions.revokeAll(id);
    }
    return updated;
  }
}
