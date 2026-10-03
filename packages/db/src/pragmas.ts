import type Database from 'better-sqlite3';

export type JournalMode = 'wal' | 'delete';

const MMAP_SIZE_BYTES = 256 * 1024 * 1024;

/**
 * Applies the connection pragmas required by SPEC section 4.1.
 *
 * @param sqlite - An open better-sqlite3 connection.
 * @param journalMode - WAL for local disks, DELETE for network shares.
 */
export function applyPragmas(sqlite: Database.Database, journalMode: JournalMode = 'wal'): void {
  sqlite.pragma(`journal_mode = ${journalMode.toUpperCase()}`);
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma(`mmap_size = ${MMAP_SIZE_BYTES}`);
}
