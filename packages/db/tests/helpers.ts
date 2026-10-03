import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultMigrationsFolder } from '../src';

/**
 * Creates a unique temporary directory for a test.
 *
 * @returns The directory path and a cleanup function.
 */
export function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-db-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Copies the shipped migrations, keeping only the first `count` journal entries.
 *
 * @param targetDir - Where to write the truncated migrations folder.
 * @param count - Number of migrations to keep.
 * @returns Path of the truncated migrations folder.
 */
export function truncatedMigrations(targetDir: string, count: number): string {
  const folder = path.join(targetDir, 'migrations-partial');
  cpSync(defaultMigrationsFolder(), folder, { recursive: true });
  const journalPath = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}
