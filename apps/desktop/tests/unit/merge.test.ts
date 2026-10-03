import { schema } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isMergeBlocked, mergeAssets } from '../../src/main/core/assets/merge';
import { unmergeAssets } from '../../src/main/core/assets/unmerge';
import { insertPlugin, insertSource, openTempLibrary, type TempLibrary } from './helpers';

const TABLES = [
  'assets',
  'instances',
  'album_assets',
  'asset_tags',
  'enrichments',
  'asset_identity',
  'faces',
] as const;

function seedAsset(
  temp: TempLibrary,
  id: string,
  createdAt: number,
  extra: Partial<typeof schema.assets.$inferInsert> = {},
) {
  const db = temp.library.db;
  db.insert(schema.assets)
    .values({ id, mediaType: 'image', createdAt, ...extra })
    .run();
  db.insert(schema.instances)
    .values({ id: `i-${id}`, assetId: id, sourceId: 's', externalId: id })
    .run();
  db.insert(schema.albumAssets)
    .values({ albumId: `album-${id}`, assetId: id })
    .run();
  db.insert(schema.albumAssets).values({ albumId: 'album-shared', assetId: id }).run();
  db.insert(schema.assetTags)
    .values({ assetId: id, tagId: `tag-${id}` })
    .run();
  db.insert(schema.enrichments)
    .values({ assetId: id, pluginId: 'p', pluginVersion: '1', key: 'exif', valueJson: `"${id}"` })
    .run();
  db.insert(schema.enrichments)
    .values({ assetId: id, pluginId: 'p', pluginVersion: '1', key: `only-${id}`, valueJson: '1' })
    .run();
  db.insert(schema.assetIdentity)
    .values({ assetId: id, pluginId: 'p', key: `sha256:${id}` })
    .run();
  db.insert(schema.faces)
    .values({ id: `face-${id}`, assetId: id })
    .run();
}

function dump(temp: TempLibrary): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    out[table] = temp.library.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all();
  }
  return out;
}

describe('mergeAssets / unmergeAssets', () => {
  let temp: TempLibrary;
  const db = () => temp.library.db;

  beforeEach(async () => {
    temp = await openTempLibrary();
    insertPlugin(temp, 'plug');
    insertSource(temp, { id: 's', pluginId: 'plug' });
    for (const id of ['album-old', 'album-new', 'album-shared']) {
      db().insert(schema.albums).values({ id, name: id }).run();
    }
    for (const id of ['tag-old', 'tag-new'])
      db().insert(schema.tags).values({ id, name: id, kind: 'user' }).run();
    seedAsset(temp, 'old', 1, { width: null, capturedAt: 100, capturedAtSource: 'mtime' });
    seedAsset(temp, 'new', 2, {
      width: 640,
      favorite: 1,
      capturedAt: 50,
      capturedAtSource: 'exif',
    });
  });

  afterEach(() => temp.cleanup());

  it('keeps the oldest asset, moves everything onto it and applies date precedence', () => {
    const result = mergeAssets(db(), 'new', 'old', 'user', 10);
    expect(result).toMatchObject({ survivingAssetId: 'old', mergedAssetId: 'new' });
    expect(
      db()
        .select()
        .from(schema.assets)
        .all()
        .map((a) => a.id),
    ).toEqual(['old']);
    const survivor = db().select().from(schema.assets).where(eq(schema.assets.id, 'old')).get()!;
    expect(survivor).toMatchObject({
      width: 640,
      favorite: 1,
      capturedAt: 50,
      capturedAtSource: 'exif',
    });
    expect(
      db()
        .select()
        .from(schema.instances)
        .all()
        .every((i) => i.assetId === 'old'),
    ).toBe(true);
    expect(
      db()
        .select()
        .from(schema.faces)
        .all()
        .every((f) => f.assetId === 'old'),
    ).toBe(true);
    const exif = db()
      .select()
      .from(schema.enrichments)
      .all()
      .filter((e) => e.key === 'exif');
    expect(exif).toEqual([expect.objectContaining({ assetId: 'old', valueJson: '"old"' })]);
    expect(db().select().from(schema.albumAssets).all()).toHaveLength(3);
  });

  it('restores the exact prior state on unmerge and blocks the pair', () => {
    const before = dump(temp);
    const { mergeId } = mergeAssets(db(), 'old', 'new', 'plugin-x', 10);
    expect(isMergeBlocked(db(), 'old', 'new')).toBe(false);
    unmergeAssets(db(), mergeId, 20);
    const after = dump(temp);
    const withoutUpdatedAt = (rows: unknown[]) =>
      rows.map((r) => ({ ...(r as object), updated_at: null }));
    expect(withoutUpdatedAt(after.assets!)).toEqual(withoutUpdatedAt(before.assets!));
    for (const table of TABLES.slice(1)) expect(after[table]).toEqual(before[table]);
    expect(isMergeBlocked(db(), 'new', 'old')).toBe(true);
  });

  it('keeps a user edit made after the merge when undoing it', () => {
    const { mergeId } = mergeAssets(db(), 'old', 'new', 'user', 10);
    db().update(schema.assets).set({ favorite: 0 }).where(eq(schema.assets.id, 'old')).run();
    unmergeAssets(db(), mergeId, 20);
    expect(
      db().select().from(schema.assets).where(eq(schema.assets.id, 'old')).get()?.favorite,
    ).toBe(0);
  });

  it('refuses invalid merges and double undo', () => {
    expect(() => mergeAssets(db(), 'old', 'old', 'user', 1)).toThrow(/itself/);
    const { mergeId } = mergeAssets(db(), 'old', 'new', 'user', 10);
    unmergeAssets(db(), mergeId, 20);
    expect(() => unmergeAssets(db(), mergeId, 30)).toThrow(/No undoable merge/);
  });
});
