export type LocalCursor = { lastPath: string } | { done: true; completedAt: string };

/**
 * Reads the resume point from a cursor. Completed or missing cursors start a fresh scan.
 *
 * @param cursor - Opaque cursor from the previous batch.
 * @returns The last committed relative path, or null for a full scan from the start.
 */
export function resumePoint(cursor: string | null): string | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as Partial<{ lastPath: string }>;
    return typeof parsed.lastPath === 'string' ? parsed.lastPath : null;
  } catch {
    return null;
  }
}

/**
 * Serializes a cursor.
 *
 * @param cursor - Cursor value.
 * @returns The opaque cursor string.
 */
export function encodeCursor(cursor: LocalCursor): string {
  return JSON.stringify(cursor);
}
