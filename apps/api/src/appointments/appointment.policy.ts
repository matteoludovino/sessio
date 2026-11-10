import { Policy } from '@nestjs/authorization';
import type { User } from '../auth/user.js';

const isFrontDesk = (user: User | null) => user?.role === 'owner' || user?.role === 'reception';

/** The front desk runs every agenda; a psychologist, only their own sessions. */
@Policy()
export class AppointmentPolicy {
  access(user: User | null) {
    return !!user;
  }

  /** Booking for a psychologist, or acting on one of their sessions. */
  manage(user: User, psychologistId: string) {
    return isFrontDesk(user) || user.id === psychologistId;
  }

  /** Whether the patient behind a session may be shown, or only "busy". */
  seePatient(user: User, psychologistId: string) {
    return isFrontDesk(user) || user.id === psychologistId;
  }
}
