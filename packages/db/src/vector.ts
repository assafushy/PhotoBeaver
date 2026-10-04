import path from 'node:path';
import type Database from 'better-sqlite3';
import { getLoadablePath } from 'sqlite-vec';

const ASAR = `${path.sep}app.asar${path.sep}`;
const ASAR_UNPACKED = `${path.sep}app.asar.unpacked${path.sep}`;

/**
 * Path of the sqlite-vec loadable extension. Inside a packaged Electron app the
 * file lives in `app.asar.unpacked`, because SQLite can't load from the archive.
 *
 * @returns Absolute path to the extension file.
 */
export function vectorExtensionPath(): string {
  return getLoadablePath().replace(ASAR, ASAR_UNPACKED);
}

/**
 * Loads sqlite-vec into a connection (needed before `faces_vec` is created or used).
 *
 * @param sqlite - The connection.
 */
export function loadVectorExtension(sqlite: Database.Database): void {
  sqlite.loadExtension(vectorExtensionPath());
}
