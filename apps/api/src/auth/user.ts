import type { StaffRole } from '../users/users.schema.js';

/** The signed-in staff member, as every request sees it. Never carries the password hash. */
export interface User {
  id: string;
  clinicId: string;
  email: string;
  name: string;
  role: StaffRole;
}
