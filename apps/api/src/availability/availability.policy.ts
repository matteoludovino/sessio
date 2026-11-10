import { Policy } from '@nestjs/authorization';
import type { User } from '../auth/user.js';

/** Everyone on the team sees schedules (to book sessions); the front desk or the person edits them. */
@Policy()
export class AvailabilityPolicy {
  view(user: User | null) {
    return !!user;
  }

  manage(user: User | null, psychologistId: string) {
    return user?.role === 'owner' || user?.role === 'reception' || user?.id === psychologistId;
  }
}
