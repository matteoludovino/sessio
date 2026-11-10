import { z } from 'zod';
import { password } from '../auth/auth.schemas.js';

/** Owners invite; the owner role itself is not invitable (one owner creates the clinic). */
export const inviteSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(2).max(120),
  role: z.enum(['reception', 'psychologist']),
});
export type InviteDto = z.infer<typeof inviteSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});
export type AcceptInvitationDto = z.infer<typeof acceptInvitationSchema>;

export const updateStaffSchema = z
  .object({
    role: z.enum(['owner', 'reception', 'psychologist']).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.active !== undefined, { message: 'Nothing to update' });
export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;

export const idParam = z.uuid();
