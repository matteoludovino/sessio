import { z } from 'zod';

export const uuidParam = z.uuid();
export const name = z.string().trim().min(1).max(120);
/** "true"/"false" in a query string. */
export const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');
