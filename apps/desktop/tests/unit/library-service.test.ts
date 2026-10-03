import { schema } from '@photobeaver/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryLibraryPage } from '../../src/main/library/library-service';
import { openTempLibrary, type TempLibrary } from './helpers';

function insertAsset(temp: TempLibrary, id: string, capturedAt: number | null, hidden = 0): void {
  temp.library.db
    .insert(schema.assets)
    .values({ id, mediaType: 'image', capturedAt, hidden })
    .run();
}

describe('queryLibraryPage', () => {
  let temp: TempLibrary;

  beforeEach(async () => {
    temp = await openTempLibrary();
  });

  afterEach(() => temp.cleanup());

  it('serves pages from the library order index', () => {
    const plan = temp.library.sqlite
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM assets
         WHERE hidden = 0 AND missing_since IS NULL
         ORDER BY COALESCE(captured_at, -9007199254740991) DESC, id DESC LIMIT 10`,
      )
      .all() as { detail: string }[];
    const details = plan.map((row) => row.detail).join(' | ');
    expect(details).toContain('assets_library_order_idx');
    expect(details).not.toContain('TEMP B-TREE');
  });

  it('returns an empty page for an empty library', () => {
    const page = queryLibraryPage(temp.library.db, { cursor: null, limit: 50 });
    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('pages newest first, undated last, skipping hidden and missing assets', () => {
    insertAsset(temp, 'a', 100);
    insertAsset(temp, 'b', 300);
    insertAsset(temp, 'c', 300);
    insertAsset(temp, 'd', null);
    insertAsset(temp, 'e', -100);
    insertAsset(temp, 'h', 999, 1);
    temp.library.db
      .insert(schema.assets)
      .values({ id: 'm', mediaType: 'image', capturedAt: 500, missingSince: 1 })
      .run();
    const first = queryLibraryPage(temp.library.db, { cursor: null, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['c', 'b']);
    expect(first.total).toBe(5);
    const second = queryLibraryPage(temp.library.db, { cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((i) => i.id)).toEqual(['a', 'e']);
    const third = queryLibraryPage(temp.library.db, { cursor: second.nextCursor, limit: 2 });
    expect(third.items.map((i) => i.id)).toEqual(['d']);
    expect(third.nextCursor).toBeNull();
  });
});
