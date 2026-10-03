import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const MIGRATIONS_TABLE = '__drizzle_migrations';

interface JournalEntry {
  idx: number;
  tag: string;
}

export interface MigrationStatus {
  applied: number;
  total: number;
  lastAppliedTag: string | null;
}

export interface MigrationOutcome extends MigrationStatus {
  backupPath: string | null;
}

function readJournal(migrationsFolder: string): JournalEntry[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  return journal.entries;
}

function countApplied(sqlite: Database.Database): number {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!table) return 0;
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${MIGRATIONS_TABLE}`).get() as {
    n: number;
  };
  return row.n;
}

/**
 * Compares migrations recorded in the DB with the shipped journal.
 *
 * @param sqlite - An open connection.
 * @param migrationsFolder - Folder containing drizzle-kit output.
 * @returns Applied and total counts plus the tag of the last applied migration.
 */
export function getMigrationStatus(
  sqlite: Database.Database,
  migrationsFolder: string,
): MigrationStatus {
  const entries = readJournal(migrationsFolder);
  const applied = countApplied(sqlite);
  const lastAppliedTag = applied > 0 ? (entries[applied - 1]?.tag ?? null) : null;
  return { applied, total: entries.length, lastAppliedTag };
}

/**
 * Builds the backup file path for a given schema version.
 *
 * @param dbPath - Path of the live database file.
 * @param tag - Tag of the last applied migration.
 * @returns A path like `photobeaver.db.bak-0000_init`.
 */
export function backupPathFor(dbPath: string, tag: string): string {
  return `${dbPath}.bak-${tag}`;
}

async function backupIfNeeded(
  sqlite: Database.Database,
  dbPath: string,
  status: MigrationStatus,
): Promise<string | null> {
  const hasPending = status.applied < status.total;
  if (!hasPending || status.lastAppliedTag === null) return null;
  const target = backupPathFor(dbPath, status.lastAppliedTag);
  if (!existsSync(target)) await sqlite.backup(target);
  return target;
}

/**
 * Runs pending migrations, taking a backup first when an existing schema will change.
 *
 * @param sqlite - The raw connection (used for status and backup).
 * @param db - The drizzle wrapper around the same connection.
 * @param dbPath - Path of the database file, used to name the backup.
 * @param migrationsFolder - Folder containing drizzle-kit output.
 * @returns Migration counts and the backup path, if one was written.
 */
export async function runMigrations(
  sqlite: Database.Database,
  db: BetterSQLite3Database<Record<string, unknown>>,
  dbPath: string,
  migrationsFolder: string,
): Promise<MigrationOutcome> {
  const before = getMigrationStatus(sqlite, migrationsFolder);
  const backupPath = await backupIfNeeded(sqlite, dbPath, before);
  migrate(db, { migrationsFolder });
  const after = getMigrationStatus(sqlite, migrationsFolder);
  return { ...after, backupPath };
}
