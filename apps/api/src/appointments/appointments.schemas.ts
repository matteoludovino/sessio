import { z } from 'zod';

const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

export const createAppointmentSchema = z.object({
  patientId: z.uuid(),
  sessionTypeId: z.uuid(),
  startsAt: instant,
  mode: z.enum(['in_person', 'online']),
  roomId: z.uuid().optional(),
});
export type CreateAppointmentDto = z.infer<typeof createAppointmentSchema>;

export const rescheduleSchema = z.object({
  /** For occurrences of a series: only this one, or this and every later one. */
  scope: z.enum(['this', 'following']).default('this'),
  startsAt: instant,
  mode: z.enum(['in_person', 'online']).optional(),
  roomId: z.uuid().nullable().optional(),
});
export type RescheduleDto = z.infer<typeof rescheduleSchema>;

export const cancelSchema = z.object({
  scope: z.enum(['this', 'following']).default('this'),
  by: z.enum(['patient', 'clinic']),
  reason: z.string().trim().max(300).optional(),
});
export type CancelDto = z.infer<typeof cancelSchema>;

const MAX_WINDOW_DAYS = 62;

export const listQuerySchema = z
  .object({
    from: instant,
    to: instant,
    psychologistId: z.uuid().optional(),
    roomId: z.uuid().optional(),
    patientId: z.uuid().optional(),
  })
  .refine((q) => q.from < q.to, { message: '"from" must be before "to"' })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_WINDOW_DAYS * 86_400_000, {
    message: `At most ${MAX_WINDOW_DAYS} days per query`,
  });
export type ListQuery = z.infer<typeof listQuerySchema>;
