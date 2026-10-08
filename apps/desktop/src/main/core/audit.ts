import { desc, eq, lt } from 'drizzle-orm';
import { schema, type LibraryDb } from '@photobeaver/db';

export interface AuditEntry {
  userId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: unknown;
}

/**
 * Appends to the audit log (SPEC 3.3).
 *
 * @param db - Database or transaction.
 * @param entry - Who did what to which target.
 * @param now - Current time.
 */
export function writeAudit(db: LibraryDb, entry: AuditEntry, now: number): void {
  db.insert(schema.auditLog)
    .values({
      userId: entry.userId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      detailsJson: entry.details === undefined ? null : JSON.stringify(entry.details),
      createdAt: now,
    })
    .run();
}

/**
 * One page of the audit log, newest first (Activity screen).
 *
 * @param db - Database.
 * @param before - Show entries older than this id, or null for the newest.
 * @param limit - Page size.
 * @returns Entries with the acting user's name, and the cursor for the next page.
 */
export function listAudit(db: LibraryDb, before: number | null, limit: number) {
  const rows = db
    .select({ entry: schema.auditLog, userName: schema.users.displayName })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .where(before === null ? undefined : lt(schema.auditLog.id, before))
    .orderBy(desc(schema.auditLog.id))
    .limit(limit + 1)
    .all();
  const items = rows.slice(0, limit).map(({ entry, userName }) => ({
    id: entry.id,
    userName: userName ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.detailsJson ? (JSON.parse(entry.detailsJson) as Record<string, unknown>) : null,
    createdAt: entry.createdAt,
  }));
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
}
