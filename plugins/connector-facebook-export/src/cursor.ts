type ExportCursor = { after: string } | { done: true };

/**
 * Reads the resume point from a cursor. Completed or missing cursors start a fresh scan.
 *
 * @param cursor - Opaque cursor from the previous batch.
 * @returns The last committed externalId, or null to scan from the start.
 */
export function resumePoint(cursor: string | null): string | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as Partial<{ after: unknown }>;
    return typeof parsed.after === 'string' ? parsed.after : null;
  } catch {
    return null;
  }
}

/**
 * Serializes a cursor.
 *
 * @param cursor - The last committed externalId, or the completed marker.
 * @returns The opaque cursor string.
 */
export function encodeCursor(cursor: ExportCursor): string {
  return JSON.stringify(cursor);
}
