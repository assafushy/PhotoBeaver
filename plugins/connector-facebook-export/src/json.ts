import { fixMojibake } from '@photobeaver/plugin-sdk/archive';

export type JsonRecord = Record<string, unknown>;

/**
 * Checks for a plain JSON object.
 *
 * @param value - Any parsed JSON value.
 * @returns True for objects that are not arrays or null.
 */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a finite number field.
 *
 * @param record - JSON object.
 * @param key - Field name.
 * @returns The number, or undefined when missing or not a finite number.
 */
export function numberField(record: JsonRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Reads a text field, repairing Meta's mojibake and dropping blank values.
 *
 * @param record - JSON object.
 * @param key - Field name.
 * @returns The trimmed, repaired text, or undefined when missing or blank.
 */
export function textField(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const text = fixMojibake(value).trim();
  return text === '' ? undefined : text;
}

/**
 * Converts epoch seconds to an ISO 8601 string.
 *
 * @param seconds - Unix time in seconds.
 * @returns The ISO string, or undefined for missing, zero or out of range values.
 */
export function isoFromSeconds(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
