import { schema } from '@photobeaver/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refreshSearchText } from '../../src/main/core/enrich/search-text';
import { geoPoints, libraryFacets } from '../../src/main/library/facets';
import { ftsQuery } from '../../src/main/library/library-filter';
import { queryLibraryPage } from '../../src/main/library/library-service';
import { insertPlugin, insertSource, openTempLibrary, type TempLibrary } from './helpers';

function addAsset(
  temp: TempLibrary,
  id: string,
  opts: {
    file: string;
    at: number;
    source?: string;
    video?: boolean;
    lat?: number;
    favorite?: number;
  },
) {
  const db = temp.library.db;
  db.insert(schema.assets)
    .values({
      id,
      mediaType: opts.video ? 'video' : 'image',
      capturedAt: opts.at,
      lat: opts.lat ?? null,
      lon: opts.lat === undefined ? null : 2,
      favorite: opts.favorite ?? 0,
    })
    .run();
  db.insert(schema.instances)
    .values({
      id: `i-${id}-${opts.source ?? 's1'}`,
      assetId: id,
      sourceId: opts.source ?? 's1',
      externalId: `${opts.source}/${opts.file}`,
      sourceMetadataJson: JSON.stringify({ filename: opts.file }),
    })
    .run();
  refreshSearchText(db, id);
}

describe('library filters', () => {
  let temp: TempLibrary;
  const ids = (filter: object) =>
    queryLibraryPage(temp.library.db, { cursor: null, limit: 100, filter }).items.map((i) => i.id);

  beforeEach(async () => {
    temp = await openTempLibrary();
    insertPlugin(temp, 'p');
    insertSource(temp, { id: 's1', pluginId: 'p' });
    insertSource(temp, { id: 's2', pluginId: 'p' });
    addAsset(temp, 'a', { file: 'Paris_Eiffel.jpg', at: 300, lat: 48.8, favorite: 1 });
    addAsset(temp, 'b', { file: 'beach-day.mp4', at: 200, video: true, source: 's2' });
    addAsset(temp, 'c', { file: 'parisian-cafe.jpg', at: 100 });
    temp.library.db
      .insert(schema.instances)
      .values({ id: 'i-c-s2', assetId: 'c', sourceId: 's2', externalId: 'x' })
      .run();
  });

  afterEach(() => temp.cleanup());

  it('builds safe FTS prefix queries', () => {
    expect(ftsQuery('Paris "OR" cafe*')).toBe('"paris"* AND "or"* AND "cafe"*');
    expect(ftsQuery('  ---  ')).toBeNull();
  });

  it('filters by text prefix, date, source, type, favorites and multiple sources', () => {
    expect(ids({ text: 'pari' })).toEqual(['a', 'c']);
    expect(ids({ text: 'eiffel paris' })).toEqual(['a']);
    expect(ids({ text: '!!!' })).toEqual([]);
    expect(ids({ from: 150, to: 250 })).toEqual(['b']);
    expect(ids({ sourceIds: ['s2'] })).toEqual(['b', 'c']);
    expect(ids({ mediaTypes: ['video'] })).toEqual(['b']);
    expect(ids({ favoritesOnly: true })).toEqual(['a']);
    expect(ids({ multiSource: true })).toEqual(['c']);
  });

  it('pages and counts within a filter', () => {
    const first = queryLibraryPage(temp.library.db, {
      cursor: null,
      limit: 1,
      filter: { text: 'paris' },
    });
    expect(first).toMatchObject({ total: 2, items: [{ id: 'a' }] });
    const second = queryLibraryPage(temp.library.db, {
      cursor: first.nextCursor,
      limit: 1,
      filter: { text: 'paris' },
    });
    expect(second.items.map((i) => i.id)).toEqual(['c']);
  });

  it('returns facets and map points', () => {
    expect(libraryFacets(temp.library.db).sources.map((s) => [s.id, s.count])).toEqual([
      ['s1', 2],
      ['s2', 2],
    ]);
    expect(geoPoints(temp.library.db, {})).toEqual({ points: [['a', 48.8, 2]], truncated: false });
  });
});
