import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupPathFor, openLibrary } from '../src';
import { makeTempDir, truncatedMigrations } from './helpers';

describe('backup before migrate', () => {
  let temp: ReturnType<typeof makeTempDir>;
  let libraryDir: string;

  beforeEach(() => {
    temp = makeTempDir();
    libraryDir = path.join(temp.dir, 'library');
  });

  afterEach(() => temp.cleanup());

  it('backs up an existing database before applying new migrations', async () => {
    const first = await openLibrary({
      libraryDir,
      migrationsFolder: truncatedMigrations(temp.dir, 1),
    });
    expect(first.migration.applied).toBe(1);
    first.close();

    const second = await openLibrary({ libraryDir });
    const expected = backupPathFor(second.dbPath, '0000_init');
    expect(second.migration.backupPath).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    expect(second.migration.applied).toBe(second.migration.total);
    second.close();
  });

  it('does not back up when nothing is pending', async () => {
    (await openLibrary({ libraryDir })).close();
    const reopened = await openLibrary({ libraryDir });
    expect(reopened.migration.backupPath).toBeNull();
    reopened.close();
  });
});
