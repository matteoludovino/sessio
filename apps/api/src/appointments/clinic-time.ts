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
