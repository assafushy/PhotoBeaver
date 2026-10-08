const UNDATED_KEY = 'undated';

const dayFormat = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const monthFormat = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  month: 'short',
  year: 'numeric',
});
const fullFormat = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  dateStyle: 'full',
  timeStyle: 'short',
});

/**
 * Day bucket for a capture time. Capture times are floating local time stored as
 * UTC, so all formatting uses the UTC zone.
 *
 * @param capturedAt - Capture time or null.
 * @returns `YYYY-MM-DD`, or 'undated'.
 */
export function dayKey(capturedAt: number | null): string {
  return capturedAt === null ? UNDATED_KEY : new Date(capturedAt).toISOString().slice(0, 10);
}

/**
 * Month bucket for a capture time.
 *
 * @param capturedAt - Capture time or null.
 * @returns `YYYY-MM`, or 'undated'.
 */
export function monthKey(capturedAt: number | null): string {
  return capturedAt === null ? UNDATED_KEY : new Date(capturedAt).toISOString().slice(0, 7);
}

export const isUndated = (key: string): boolean => key === UNDATED_KEY;
export const formatDay = (capturedAt: number): string => dayFormat.format(capturedAt);
export const formatMonth = (capturedAt: number): string => monthFormat.format(capturedAt);
export const formatFull = (capturedAt: number): string => fullFormat.format(capturedAt);

const instantFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * A real moment (audit entries, sign-ins) in the computer's own time zone,
 * unlike capture times, which are floating local time.
 *
 * @param timestamp - Epoch milliseconds.
 * @returns The formatted date and time.
 */
export const formatInstant = (timestamp: number): string => instantFormat.format(timestamp);
