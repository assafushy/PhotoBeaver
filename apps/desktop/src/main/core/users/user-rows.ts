import { schema, type LibraryDb } from '@photobeaver/db';
import type { UserSummary } from '@photobeaver/shared';
import { and, eq, ne } from 'drizzle-orm';
import { readScope } from '../access/scope';

const { users } = schema;

export type UserRow = typeof users.$inferSelect;

/**
 * Loads a user or throws.
 *
 * @param db - Database.
 * @param id - User id.
 * @returns The row.
 */
export function requireUser(db: LibraryDb, id: string): UserRow {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  if (!row) throw new Error('User not found');
  return row;
}

/**
 * How users appear on the Users screen (no secrets).
 *
 * @param db - Database.
 * @param row - User row.
 * @returns The summary.
 */
export function toSummary(db: LibraryDb, row: UserRow): UserSummary {
  const scope = readScope(db, { id: row.id, role: 'viewer' });
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    secretKind: row.secretHash ? (row.secretKind ?? 'password') : null,
    biometric: row.biometricEnabled === 1,
    disabled: row.disabled === 1,
    lastLoginAt: row.lastLoginAt ?? null,
    scopes: { sourceIds: scope?.sourceIds ?? [], albumIds: scope?.albumIds ?? [] },
  };
}

/**
 * Refuses a change that would leave the library without an enabled Admin (SPEC 3.3).
 *
 * @param db - Database or transaction.
 * @param target - The user being demoted, disabled or deleted.
 * @throws Error when it is the last enabled Admin.
 */
export function assertNotLastAdmin(db: LibraryDb, target: UserRow): void {
  if (target.role !== 'admin' || target.disabled === 1) return;
  const other = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, 0), ne(users.id, target.id)))
    .get();
  if (!other) throw new Error('There must always be at least one Admin');
}
