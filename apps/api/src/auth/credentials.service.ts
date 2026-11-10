import { Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { ConfigService } from '@nestjs/config';
import { Semaphore } from '../common/semaphore.js';
import type { Env } from '../config/env.js';
import { UsersRepository } from '../users/users.repository.js';
import type { User } from './user.js';

@Injectable()
export class CredentialsService {
  /**
   * scrypt is memory-hard on purpose: 128 MiB per derivation at the default cost. A few at once
   * would exhaust a small instance, so derivations queue instead (sign-ins wait a little longer).
   */
  private readonly derivations: Semaphore;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
    config: ConfigService<Env, true>,
  ) {
    this.derivations = new Semaphore(config.get('PASSWORD_HASH_CONCURRENCY', { infer: true }));
  }

  hash(password: string): Promise<string> {
    return this.derivations.run(() => this.passwordHasher.hash(password));
  }

  /** The user, or null when the email, the password or the account status is wrong. */
  async verify(email: string, password: string): Promise<User | null> {
    const found = await this.usersRepository.findCredentials(email);
    // With no account, verify() still checks a dummy hash: response time doesn't reveal which emails exist.
    const valid = await this.derivations.run(() => this.passwordHasher.verify(password, found?.passwordHash));
    if (!valid || !found?.passwordHash || !found.active) {
      return null;
    }
    if (this.passwordHasher.needsRehash(found.passwordHash)) {
      await this.usersRepository.updatePasswordHash(found.user.id, await this.hash(password));
    }
    return found.user;
  }
}
