import { DateTime } from 'luxon';

/** ISO instant → value for <input type="datetime-local">, in the clinic's timezone. */
export const toLocalInput = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toFormat("yyyy-MM-dd'T'HH:mm");

/** <input type="datetime-local"> value read as clinic time → ISO instant with offset. */
export const fromLocalInput = (value: string, zone: string) => DateTime.fromISO(value, { zone }).toISO({ suppressMilliseconds: true }) ?? '';

export const nowIso = () => new Date().toISOString();
export const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
export const hoursUntil = (iso: string) => (new Date(iso).getTime() - Date.now()) / 3_600_000;
export const isFuture = (iso: string) => new Date(iso).getTime() > Date.now();
