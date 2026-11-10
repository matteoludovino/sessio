import { z } from 'zod';

/** "08:30" ↔ 510 minutes since midnight. "24:00" is a valid end of day. */
export const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use o formato HH:MM')
  .transform((v) => {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  });

export const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
