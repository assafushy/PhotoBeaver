import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { applyPragmas, type JournalMode } from './pragmas';
import { runMigrations, type MigrationOutcome } from './migrations';
import * as schema from './schema';

export const DB_FILENAME = 'photobeaver.db';

export type LibraryDb = BetterSQLite3Database<typeof schema>;

export interface OpenLibraryOptions {
  libraryDir: string;
  migrationsFolder?: string;
  journalMode?: JournalMode;
}

export interface OpenLibrary {
  sqlite: Database.Database;
  db: LibraryDb;
  dbPath: string;
  migration: MigrationOutcome;
  close(): void;
}

/**
 * Default location of the drizzle-kit migrations shipped with this package.
 *
 * @returns Absolute path to `packages/db/migrations`.
 */
export function defaultMigrationsFolder(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

/**
 * Opens (creating if needed) the library database, applies pragmas and migrations.
 *
 * @param options - Library directory, migrations folder and journal mode.
 * @returns The open connection, drizzle wrapper and migration outcome.
 */
export async function openLibrary(options: OpenLibraryOptions): Promise<OpenLibrary> {
  mkdirSync(options.libraryDir, { recursive: true });
  const dbPath = path.join(options.libraryDir, DB_FILENAME);
  const sqlite = new Database(dbPath);
  applyPragmas(sqlite, options.journalMode);
  const db = drizzle(sqlite, { schema });
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();
  const migration = await runMigrations(sqlite, db, dbPath, migrationsFolder);
  return { sqlite, db, dbPath, migration, close: () => sqlite.close() };
}
