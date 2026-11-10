import { Injectable } from '@nestjs/common';
import { AuthenticationRegistry, SessionCookieProvider, type SessionRecord } from '@nestjs/authentication';
import { UsersRepository } from '../users/users.repository.js';
import type { User } from './user.js';

/** Reads the session cookie and loads its user on every request. */
@Injectable()
export class SessionAuth extends SessionCookieProvider<User> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  // Returning null (user deleted or deactivated) ends the session at once.
  validate(session: SessionRecord) {
    return this.usersRepository.findActiveById(session.userId);
  }
}
