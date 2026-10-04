export type CapturedAtSource = 'user' | 'exif' | 'source' | 'enricher' | 'filename' | 'mtime';

export interface CapturedAt {
  value: number;
  source: CapturedAtSource;
}

const PRECEDENCE: Record<CapturedAtSource, number> = {
  user: 5,
  exif: 4,
  source: 3,
  enricher: 2,
  filename: 1,
  mtime: 0,
};

/**
 * Rank of a core-field source (SPEC 6.3): user > exif > source > enricher > filename > mtime.
 *
 * @param source - Where a value came from.
 * @returns Higher wins.
 */
export function precedenceOf(source: CapturedAtSource): number {
  return PRECEDENCE[source];
}

const FILENAME_PATTERNS: RegExp[] = [
  /(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?:\d{3})?(?!\d)/,
  /(?:^|[^\d])((?:19|20)\d{2})-(\d{2})-(\d{2})[ _T.-](\d{2})[.:-]?(\d{2})[.:-]?(\d{2})(?!\d)/,
  /(?:^|[^\d])((?:19|20)\d{2})-(\d{2})-(\d{2})(?!\d)/,
  /(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/,
];

function toUtcMs(parts: number[]): number | null {
  const [year, month, day, hour = 0, minute = 0, second = 0] = parts as [
    number,
    number,
    number,
    ...number[],
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(ms).getUTCDate() === day ? ms : null;
}

/**
 * Extracts a capture time from common camera and phone filenames
 * (`IMG_20230105_142233`, `PXL_20230105_142233123`, `2023-01-05 14.22.33`, `20230105`).
 * The time is read as UTC because filenames carry no zone.
 *
 * @param filename - The file name.
 * @returns UTC milliseconds, or null when no plausible date is found.
 */
export function dateFromFilename(filename: string): number | null {
  for (const pattern of FILENAME_PATTERNS) {
    const match = pattern.exec(filename);
    if (!match) continue;
    const ms = toUtcMs(match.slice(1).map(Number));
    if (ms !== null) return ms;
  }
  return null;
}

/**
 * Converts an absolute instant to floating local time: the machine's wall-clock
 * reading encoded as UTC milliseconds, the same encoding EXIF and filename dates use.
 *
 * @param instantMs - UTC epoch milliseconds.
 * @returns Wall-clock milliseconds.
 */
export function toFloatingTime(instantMs: number): number {
  return instantMs - new Date(instantMs).getTimezoneOffset() * 60_000;
}

function parseIso(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Best capture time a connector item can provide: source value, then filename, then mtime.
 * All values are floating local time (wall clock encoded as UTC); the UI formats them in UTC.
 *
 * @param item - The fields of a MediaItem that carry time information.
 * @returns The value and where it came from, or null.
 */
export function captureDateFromItem(item: {
  capturedAt?: string;
  filename?: string;
  modifiedAt?: string;
}): CapturedAt | null {
  const fromSource = parseIso(item.capturedAt);
  if (fromSource !== null) return { value: fromSource, source: 'source' };
  const fromName = item.filename ? dateFromFilename(item.filename) : null;
  if (fromName !== null) return { value: fromName, source: 'filename' };
  const fromMtime = parseIso(item.modifiedAt);
  return fromMtime === null ? null : { value: toFloatingTime(fromMtime), source: 'mtime' };
}

/**
 * Applies the core-field precedence (SPEC 6.3): a proposal replaces the current
 * value only if its source ranks at least as high.
 *
 * @param current - The stored value, if any.
 * @param proposal - The new candidate, if any.
 * @returns The value to store.
 */
export function pickCapturedAt(
  current: CapturedAt | null,
  proposal: CapturedAt | null,
): CapturedAt | null {
  if (!proposal) return current;
  if (!current) return proposal;
  return PRECEDENCE[proposal.source] >= PRECEDENCE[current.source] ? proposal : current;
}
