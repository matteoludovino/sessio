import { z } from 'zod';

const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

export const createSeriesSchema = z.object({
  patientId: z.uuid(),
  sessionTypeId: z.uuid(),
  mode: z.enum(['in_person', 'online']),
  roomId: z.uuid().optional(),
  /** The first occurrence; its local weekday and time repeat. */
  startsAt: instant,
  intervalWeeks: z.union([z.literal(1), z.literal(2)]).default(1),
  /** Last local date an occurrence may fall on. Omit both limits for an open-ended series. */
  untilDate: z.iso.date().optional(),
  maxOccurrences: z.number().int().min(1).max(520).optional(),
  /** Create the series without the conflicting dates instead of refusing it (409). */
  skipConflicts: z.boolean().default(false),
});
export type CreateSeriesDto = z.infer<typeof createSeriesSchema>;

export const scope = z.enum(['this', 'following']).default('this');
