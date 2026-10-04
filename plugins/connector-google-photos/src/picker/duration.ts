const DURATION = /^(\d+(?:\.\d+)?)s$/;

/**
 * Parses a protobuf JSON duration such as "5s" or "0.5s".
 *
 * @param value - Duration string from the API.
 * @param fallbackMs - Value to use when the string is missing or malformed.
 * @returns Milliseconds.
 */
export function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  const match = DURATION.exec(value?.trim() ?? '');
  if (!match) return fallbackMs;
  const ms = Number(match[1]) * 1000;
  return Number.isFinite(ms) ? ms : fallbackMs;
}
