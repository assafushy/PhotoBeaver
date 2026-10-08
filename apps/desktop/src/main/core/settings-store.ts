import { schema, type LibraryDb } from '@photobeaver/db';
import { eq } from 'drizzle-orm';

/**
 * Reads a JSON value from the library `settings` table.
 *
 * @param db - Database.
 * @param key - Setting key.
 * @param fallback - Value when unset.
 * @returns The stored or fallback value.
 */
export function readSetting<T>(db: LibraryDb, key: string, fallback: T): T {
  const row = db
    .select({ value: schema.settings.valueJson })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get();
  return row?.value ? (JSON.parse(row.value) as T) : fallback;
}

/**
 * Writes a JSON value to the library `settings` table.
 *
 * @param db - Database or transaction.
 * @param key - Setting key.
 * @param value - JSON-serializable value.
 */
export function writeSetting(db: LibraryDb, key: string, value: unknown): void {
  const valueJson = JSON.stringify(value);
  db.insert(schema.settings)
    .values({ key, valueJson })
    .onConflictDoUpdate({ target: schema.settings.key, set: { valueJson } })
    .run();
}
