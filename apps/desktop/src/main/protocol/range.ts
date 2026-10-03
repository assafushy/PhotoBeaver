export interface ByteRange {
  start: number;
  end: number;
}

const RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses a single HTTP Range header against a file size.
 *
 * @param header - The Range header value, or null.
 * @param size - File size in bytes.
 * @returns The inclusive byte range, null for a full response, or 'invalid' (416).
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = RANGE.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  const [, from, to] = match;
  if (from === '') {
    const suffix = Number(to);
    return suffix === 0 ? 'invalid' : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start >= size || start > end ? 'invalid' : { start, end };
}
