import { Policy } from '@nestjs/authorization';
import type { User } from '../auth/user.js';
import type { Patient } from './patients.schema.js';

const isFrontDesk = (user: User | null) => user?.role === 'owner' || user?.role === 'reception';

/** Owner and reception handle every patient; a psychologist, only their own. */
@Policy()
export class PatientPolicy {
  access(user: User | null) {
    return !!user;
  }

  view(user: User, patient: Patient) {
    return isFrontDesk(user) || patient.psychologistId === user.id;
  }

  update(user: User, patient: Patient) {
    return isFrontDesk(user) || patient.psychologistId === user.id;
  }

  /** Archiving and reassigning to another psychologist are front-desk decisions. */
  archive(user: User) {
    return isFrontDesk(user);
  }

  reassign(user: User) {
    return isFrontDesk(user);
  }
}
