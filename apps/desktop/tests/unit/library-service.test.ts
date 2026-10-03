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

  it('returns an empty page for an empty library', () => {
    const page = queryLibraryPage(temp.library.db, { cursor: null, limit: 50 });
    expect(page).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it('pages newest first with a keyset cursor and skips hidden assets', () => {
    insertAsset(temp, 'a', 100);
    insertAsset(temp, 'b', 300);
    insertAsset(temp, 'c', 300);
    insertAsset(temp, 'd', null);
    insertAsset(temp, 'h', 999, 1);
    const first = queryLibraryPage(temp.library.db, { cursor: null, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['c', 'b']);
    expect(first.total).toBe(4);
    const second = queryLibraryPage(temp.library.db, { cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((i) => i.id)).toEqual(['a', 'd']);
    expect(second.nextCursor).toBeNull();
  });
});
