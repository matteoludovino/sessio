import { Policy } from '@nestjs/authorization';
import type { User } from '../auth/user.js';

/** Clinic configuration (rooms, session types): everyone on the team reads, the owner changes. */
@Policy()
export class ClinicConfigPolicy {
  view(user: User | null) {
    return !!user;
  }

  manage(user: User | null) {
    return user?.role === 'owner';
  }
}
