const UNITS = ['B', 'KB', 'MB', 'GB'];

/**
 * Human-readable file size.
 *
 * @param bytes - Size in bytes, or null when unknown.
 * @returns For example "2.4 MB", or an empty string.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${UNITS[unit]}`;
}
