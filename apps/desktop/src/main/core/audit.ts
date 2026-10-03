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
