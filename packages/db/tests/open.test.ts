import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_FILENAME, openLibrary, type OpenLibrary } from '../src';
import { makeTempDir } from './helpers';

const EXPECTED_TABLES = [
  'album_assets',
  'albums',
  'asset_identity',
  'asset_merges',
  'asset_tags',
  'assets',
  'assets_fts',
  'audit_log',
  'duplicate_suggestions',
  'enrichments',
  'faces',
  'instances',
  'jobs',
  'people',
  'plugin_kv',
  'plugins',
  'settings',
  'sources',
  'tags',
  'user_scopes',
  'users',
];

describe('openLibrary', () => {
  let temp: ReturnType<typeof makeTempDir>;
  let library: OpenLibrary;

  beforeEach(async () => {
    temp = makeTempDir();
    library = await openLibrary({ libraryDir: path.join(temp.dir, 'library') });
  });

  afterEach(() => {
    library.close();
    temp.cleanup();
  });

  it('creates the database file inside the library dir', () => {
    expect(library.dbPath).toBe(path.join(temp.dir, 'library', DB_FILENAME));
    expect(existsSync(library.dbPath)).toBe(true);
  });

  it('applies the required pragmas', () => {
    const pragma = (name: string): unknown => library.sqlite.pragma(name, { simple: true });
    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('synchronous')).toBe(1);
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('busy_timeout')).toBe(5000);
    expect(pragma('temp_store')).toBe(2);
  });

  it('creates every table from the data model', () => {
    const rows = library.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const names = new Set(rows.map((r) => r.name));
    for (const table of EXPECTED_TABLES) expect(names).toContain(table);
  });

  it('reports all migrations applied without a backup on a fresh library', () => {
    expect(library.migration.applied).toBe(library.migration.total);
    expect(library.migration.backupPath).toBeNull();
  });

  it('supports full-text search', () => {
    library.sqlite
      .prepare('INSERT INTO assets_fts (asset_id, text) VALUES (?, ?)')
      .run('a1', 'Paris trip');
    const hit = library.sqlite
      .prepare("SELECT asset_id FROM assets_fts WHERE assets_fts MATCH 'paris'")
      .get();
    expect(hit).toEqual({ asset_id: 'a1' });
  });
});
