import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { Mailer } from '@nestjs/mail';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { CredentialsService } from '../auth/credentials.service.js';
import type { User } from '../auth/user.js';
import { clinics } from '../clinics/clinics.schema.js';
import type { Env } from '../config/env.js';
import type { Database } from '../db/db.module.js';
import { PgError, pgErrorCode } from '../db/errors.js';
import { Tenant } from '../tenancy/tenant.js';
import { normalizeEmail, UsersRepository } from '../users/users.repository.js';
import { invitations } from './invitations.schema.js';
import { StaffInvitationMail } from './staff-invitation.mail.js';
import type { AcceptInvitationDto, InviteDto } from './staff.schemas.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class InvitationsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly tenant: Tenant,
    private readonly usersRepository: UsersRepository,
    private readonly credentials: CredentialsService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Stores only the token's hash and mails the token to the invitee. The response never
   * contains it, so the owner can't accept on someone's behalf.
   */
  async invite(dto: InviteDto) {
    const inviter = this.tenant.user();
    const email = normalizeEmail(dto.email);
    if (await this.usersRepository.existsByEmail(email)) {
      throw new ConflictException('Este e-mail já pertence a um usuário.');
    }
    const token = randomBytes(32).toString('base64url');
    const [invitation] = await this.db
      .insert(invitations)
      .values({
        clinicId: inviter.clinicId,
        email,
        name: dto.name,
        role: dto.role,
        tokenHash: sha256(token),
        invitedBy: inviter.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      })
      .returning({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
      });

    const [clinic] = await this.db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, inviter.clinicId));
    const acceptUrl = new URL('/convite', this.config.get('WEB_ORIGIN', { infer: true }));
    acceptUrl.searchParams.set('token', token);
    // Sent after the commit. Stage 6 moves this to the transactional outbox, with retries.
    await this.mailer.send(StaffInvitationMail, {
      to: { name: dto.name, address: email },
      data: { clinicName: clinic.name, inviteeName: dto.name, inviterName: inviter.name, acceptUrl: acceptUrl.href },
    });
    return invitation;
  }

  /** Consumes the invitation and creates the account in one transaction: a token works once. */
  async accept(dto: AcceptInvitationDto): Promise<User> {
    const passwordHash = await this.credentials.hash(dto.password);
    try {
      return await this.db.transaction(async (tx) => {
        // Conditional UPDATE: of two concurrent accepts of one token, exactly one gets the row.
        const [invitation] = await tx
          .update(invitations)
          .set({ acceptedAt: new Date() })
          .where(
            and(
              eq(invitations.tokenHash, sha256(dto.token)),
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, new Date()),
            ),
          )
          .returning();
        if (!invitation) {
          throw new GoneException('Convite inválido, expirado ou já utilizado.');
        }
        return this.usersRepository.create(
          {
            clinicId: invitation.clinicId,
            email: invitation.email,
            name: invitation.name,
            role: invitation.role,
            passwordHash,
          },
          tx,
        );
      });
    } catch (error) {
      if (pgErrorCode(error) === PgError.uniqueViolation) {
        throw new ConflictException('Este e-mail já pertence a um usuário.');
      }
      throw error;
    }
  }
}
