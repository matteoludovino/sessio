import { Injectable } from '@nestjs/common';
import { AuthenticationContext } from '@nestjs/authentication';
import type { User } from '../auth/user.js';

/**
 * The one place that decides which clinic a request acts on: always the signed-in user's.
 * Services pass `clinicId()` to every repository call, and repositories filter by it, so a
 * record id from another clinic is simply not found (404, never 403: no existence leak).
 */
@Injectable()
export class Tenant {
  constructor(private readonly context: AuthenticationContext) {}

  user(): User {
    return this.context.requireUser();
  }

  clinicId(): string {
    return this.user().clinicId;
  }
}
