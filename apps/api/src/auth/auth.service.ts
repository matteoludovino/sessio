import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { clinics } from '../clinics/clinics.schema.js';
import type { Database } from '../db/db.module.js';
import { PgError, pgErrorCode } from '../db/errors.js';
import { UsersRepository } from '../users/users.repository.js';
import type { SignUpDto } from './auth.schemas.js';
import { CredentialsService } from './credentials.service.js';
import type { User } from './user.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly usersRepository: UsersRepository,
    private readonly credentials: CredentialsService,
  ) {}

  /** A new clinic and its owner, in one transaction: both exist or neither does. */
  async registerClinic(dto: SignUpDto): Promise<User> {
    const passwordHash = await this.credentials.hash(dto.password);
    try {
      return await this.db.transaction(async (tx) => {
        const [clinic] = await tx.insert(clinics).values({ name: dto.clinicName }).returning({ id: clinics.id });
        return this.usersRepository.create(
          { clinicId: clinic.id, email: dto.email, name: dto.name, role: 'owner', passwordHash },
          tx,
        );
      });
    } catch (error) {
      // The unique index on users.email decides, also between two concurrent sign-ups.
      if (pgErrorCode(error) === PgError.uniqueViolation) {
        throw new ConflictException('Este e-mail já está cadastrado.');
      }
      throw error;
    }
  }
}
