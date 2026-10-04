const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:Z|[+-]\d{2}:?\d{2})?$/;
const QUICKTIME_EPOCH_OFFSET_SEC = 2082844800;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/**
 * Turns a fraction-of-second digit string (EXIF SubSecTime) into milliseconds.
 *
 * @param fraction - Digits after the decimal point, such as "25" (250 ms) or "123".
 * @returns Whole milliseconds, 0 when the value is missing or not digits.
 */
export function fractionToMs(fraction: unknown): number {
  const digits = typeof fraction === 'number' ? String(fraction) : fraction;
  if (typeof digits !== 'string' || !/^\d+$/.test(digits.trim())) return 0;
  return Math.floor(Number(`0.${digits.trim()}`) * 1000);
}

function isValidWallClock(clock: WallClock, date: Date): boolean {
  return (
    clock.year >= 1800 &&
    date.getUTCFullYear() === clock.year &&
    date.getUTCMonth() === clock.month - 1 &&
    date.getUTCDate() === clock.day &&
    date.getUTCHours() === clock.hour &&
    date.getUTCMinutes() === clock.minute &&
    date.getUTCSeconds() === clock.second
  );
}

function wallClockToIso(clock: WallClock): string | undefined {
  const { year, month, day, hour, minute, second, millisecond } = clock;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  date.setUTCFullYear(year);
  return isValidWallClock(clock, date) ? date.toISOString() : undefined;
}

function clockFromMatch(match: RegExpExecArray, millisecond: number): WallClock {
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as number[];
  return { year, month, day, hour, minute, second, millisecond } as WallClock;
}

/**
 * Converts an EXIF date ("2023:05:01 14:22:33") to floating time: the wall clock
 * encoded as if it were UTC (D41). Any time zone offset is ignored on purpose.
 *
 * @param value - The EXIF date string.
 * @param subSec - Optional SubSecTime digits.
 * @returns An ISO string ending in "Z", or undefined when the value is not a real date.
 */
export function exifDateToFloating(value: unknown, subSec?: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = EXIF_DATE.exec(value.trim());
  return match ? wallClockToIso(clockFromMatch(match, fractionToMs(subSec))) : undefined;
}

/**
 * Converts an ISO 8601 date with an optional offset ("2021-07-04T19:11:12+0900") to
 * floating time: the wall clock of that offset, encoded as if it were UTC (D41).
 *
 * @param value - The ISO date string.
 * @returns An ISO string ending in "Z", or undefined when the value is not a real date.
 */
export function offsetDateToFloating(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ISO_DATE.exec(value.trim());
  return match ? wallClockToIso(clockFromMatch(match, fractionToMs(match[7]))) : undefined;
}

/**
 * Expresses an instant as floating time for a fixed time zone offset (D41).
 *
 * @param ms - The instant in milliseconds since the Unix epoch.
 * @param offsetMinutes - The zone offset as `Date#getTimezoneOffset` reports it (UTC+2 is -120).
 * @returns The wall clock of that zone as an ISO string ending in "Z".
 */
export function toFloating(ms: number, offsetMinutes: number): string {
  return new Date(ms - offsetMinutes * 60000).toISOString();
}

/**
 * Expresses an instant as floating time in the zone of this machine, the same way core
 * converts file mtimes (D41).
 *
 * @param ms - The instant in milliseconds since the Unix epoch.
 * @returns The local wall clock as an ISO string ending in "Z".
 */
export function instantToLocalFloating(ms: number): string {
  return toFloating(ms, new Date(ms).getTimezoneOffset());
}

/**
 * Converts a QuickTime timestamp (seconds since 1904-01-01 UTC) to floating time in the
 * zone of this machine (D41).
 *
 * @param seconds - The timestamp; 0 means "not set".
 * @returns An ISO string ending in "Z", or undefined when missing or out of range.
 */
export function quickTimeToFloating(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const ms = (seconds - QUICKTIME_EPOCH_OFFSET_SEC) * 1000;
  const year = new Date(ms).getUTCFullYear();
  return year >= 1904 && year <= 9999 ? instantToLocalFloating(ms) : undefined;
}
