/**
 * Wall-clock time in the clinic's zone, with Intl only (no dependency). Working hours are local
 * ("Mondays 08:00-12:00"), sessions are instants: this maps one onto the other.
 */
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalTime {
  /** YYYY-MM-DD in the clinic's zone. */
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  /** Minutes since local midnight. */
  minute: number;
}

export function localTime(instant: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday],
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export interface WeeklyRange {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Whether [startsAt, endsAt) lies inside one working range of its local day. A session ending at
 * local midnight fits a range that ends at 24:00; one crossing midnight never fits.
 */
export function fitsWorkingHours(startsAt: Date, endsAt: Date, timeZone: string, ranges: readonly WeeklyRange[]): boolean {
  const start = localTime(startsAt, timeZone);
  const durationMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  const endMinute = start.minute + durationMinutes;
  if (endMinute > 1440) {
    return false;
  }
  return ranges.some((r) => r.weekday === start.weekday && r.startMinute <= start.minute && endMinute <= r.endMinute);
}

/** Offset of the zone from UTC at an instant, in minutes (São Paulo: -180). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The instant of a local wall-clock time ("2030-01-07", 08:00 in São Paulo → 11:00Z). Two passes
 * settle the offset, so it also holds across daylight-saving changes in zones that have them.
 */
export function zonedInstant(date: string, minute: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minute);
  let instant = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  instant = naive - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** Calendar arithmetic on YYYY-MM-DD, independent of any zone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
