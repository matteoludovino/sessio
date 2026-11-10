import { Policy } from '@nestjs/authorization';
import type { User } from '../auth/user.js';

/** Who may manage the team. A guest arrives as null and is always denied. */
@Policy()
export class StaffPolicy {
  invite(user: User | null) {
    return user?.role === 'owner';
  }

  list(user: User | null) {
    return user?.role === 'owner' || user?.role === 'reception';
  }

  update(user: User | null) {
    return user?.role === 'owner';
  }
}
