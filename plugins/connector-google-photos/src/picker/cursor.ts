export const DONE_CURSOR = 'done';

export interface PageCursor {
  sessionId: string;
  pageToken: string;
}

const PAGE_CURSOR = /^session:([^:]+):page:(.*)$/s;

/**
 * Serializes the position of the next page to read in a session.
 *
 * @param cursor - Session id and page token.
 * @returns The opaque cursor.
 */
export function encodePageCursor(cursor: PageCursor): string {
  return `session:${cursor.sessionId}:page:${cursor.pageToken}`;
}

/**
 * Reads a page cursor. Null, "done" and unknown values mean "start a new pick".
 *
 * @param cursor - Cursor from the previous batch.
 * @returns The session position to resume, or null.
 */
export function decodePageCursor(cursor: string | null): PageCursor | null {
  const match = cursor === null ? null : PAGE_CURSOR.exec(cursor);
  return match ? { sessionId: match[1]!, pageToken: match[2]! } : null;
}
