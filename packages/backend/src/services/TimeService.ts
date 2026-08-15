/**
 * Centralized business-timezone date/time utilities.
 *
 * The system stores booking `date` + `startTime`/`endTime` ("HH:mm") as
 * business-local values. All conversions go through this module so that no
 * service depends on the host server's timezone.
 */

const IANA_TIMEZONES: Set<string> | null = new Set(
  (() => {
    try {
      return Intl.supportedValuesOf('timeZone') as string[];
    } catch {
      return [];
    }
  })()
);

export class TimeService {
  /** Validate an IANA timezone identifier. */
  isValidTimezone(tz: string): boolean {
    if (!tz) return false;
    // Fast path: listed by this ICU build
    if (IANA_TIMEZONES && IANA_TIMEZONES.has(tz)) return true;
    // Fallback: Intl accepts any zone the ICU tz database knows, including
    // canonical/alias names not returned by supportedValuesOf (e.g. Asia/Kolkata)
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
      return true;
    } catch {
      return false;
    }
  }

  /** Validate a HH:mm string. */
  isValidTime(time: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  }

  /** Validate a YYYY-MM-DD string. */
  isValidDate(dateStr: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  }

  /** Offset in milliseconds of `tz` at UTC instant `at`. */
  private timeZoneOffsetMs(tz: string, at: number): number {
    try {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'longOffset',
      });
      const parts = dtf.formatToParts(new Date(at));
      const name = parts.find((p) => p.type === 'timeZoneName')?.value || '';
      const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
      if (!m) return 0;
      const sign = m[1] === '-' ? -1 : 1;
      return sign * (Number(m[2]) * 3600000 + Number(m[3]) * 60000);
    } catch {
      return 0;
    }
  }

  /**
   * Convert a business-local date ("YYYY-MM-DD") + time ("HH:mm") into an
   * absolute UTC instant. Handles DST boundaries with one refinement pass.
   */
  toUtc(tz: string, dateStr: string, timeStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const naive = Date.UTC(y, m - 1, d, hh, mm);
    const offset = this.timeZoneOffsetMs(tz, naive);
    const refined = naive - offset;
    const offset2 = this.timeZoneOffsetMs(tz, refined);
    return new Date(offset2 !== offset ? naive - offset2 : refined);
  }

  /** Day of week (0=Sunday) for a business-local date string. */
  dayOfWeek(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  /** Format an absolute Date in the business timezone as "YYYY-MM-DD". */
  toDateStr(date: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  /** Format an absolute Date in the business timezone as "HH:mm". */
  toTimeStr(date: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    return `${get('hour')}:${get('minute')}`;
  }

  /**
   * Business-local "now" as a YYYY-MM-DD string. Booking window checks and
   * next-available searches use this instead of the host clock.
   */
  todayStr(tz: string): string {
    return this.toDateStr(new Date(), tz);
  }

  /**
   * Canonical booking-day representation: the business-local date string
   * stored as UTC midnight (timezone-independent, query-stable).
   */
  dateToUtcMidnight(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  /** Inclusive [start, end] bounds for a date-string day, in UTC. */
  dayRangeUtc(dateStr: string): { gte: Date; lte: Date } {
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = Date.UTC(y, m - 1, d);
    return { gte: new Date(start), lte: new Date(start + 86400000 - 1) };
  }

  /**
   * Number of business-local days between today (in tz) and dateStr.
   * Positive when dateStr is in the future.
   */
  daysFromToday(tz: string, dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = Date.UTC(y, m - 1, d);
    const [ty, tm, td] = this.todayStr(tz).split('-').map(Number);
    const today = Date.UTC(ty, tm - 1, td);
    return Math.round((target - today) / 86400000);
  }
}

export const timeService = new TimeService();
