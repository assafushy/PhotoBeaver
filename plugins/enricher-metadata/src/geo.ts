import type { GeoPoint } from '@photobeaver/plugin-sdk';

const ISO6709 = /^([+-])(\d+(?:\.\d+)?)([+-])(\d+(?:\.\d+)?)/;

/**
 * Builds a location when the coordinates are real: finite, in range and not (0, 0).
 *
 * @param lat - Latitude in decimal degrees.
 * @param lon - Longitude in decimal degrees.
 * @returns The point, or undefined when it is missing or invalid.
 */
export function validLocation(lat: unknown, lon: unknown): GeoPoint | undefined {
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  if (lat === 0 && lon === 0) return undefined;
  return { lat, lon };
}

function sexagesimal(text: string, degreeDigits: number): number {
  const dot = text.indexOf('.');
  const whole = dot < 0 ? text : text.slice(0, dot);
  const fraction = dot < 0 ? '' : text.slice(dot);
  const degrees = Number(whole.slice(0, degreeDigits));
  const rest = whole.slice(degreeDigits);
  if (rest.length === 0) return Number(whole + fraction);
  if (rest.length <= 2) return degrees + Number(rest + fraction) / 60;
  return degrees + Number(rest.slice(0, 2)) / 60 + Number(rest.slice(2) + fraction) / 3600;
}

/**
 * Parses an ISO 6709 location string such as "+48.8584+002.2945/" or
 * "+35.6895+139.6917+040.000/". Degree, degree-minute and degree-minute-second forms work.
 *
 * @param value - The ISO 6709 string.
 * @returns The point, or undefined when it cannot be parsed or is invalid.
 */
export function parseIso6709(value: unknown): GeoPoint | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ISO6709.exec(value.trim());
  if (!match) return undefined;
  const lat = sexagesimal(match[2]!, 2) * (match[1] === '-' ? -1 : 1);
  const lon = sexagesimal(match[4]!, 3) * (match[3] === '-' ? -1 : 1);
  return validLocation(lat, lon);
}

/**
 * Converts EXIF GPS degrees (a number or [degrees, minutes, seconds]) and a reference
 * letter (N, S, E, W) to signed decimal degrees.
 *
 * @param value - The GPSLatitude or GPSLongitude value.
 * @param ref - The matching reference letter.
 * @returns Signed decimal degrees, or undefined when the value is unusable.
 */
export function gpsToDecimal(value: unknown, ref: unknown): number | undefined {
  const parts = Array.isArray(value) ? value : [value];
  if (parts.length === 0 || parts.some((part) => typeof part !== 'number')) return undefined;
  const [degrees = 0, minutes = 0, seconds = 0] = parts as number[];
  const decimal = degrees + minutes / 60 + seconds / 3600;
  const negative = typeof ref === 'string' && /^[SW]/i.test(ref.trim());
  return negative ? -decimal : decimal;
}
