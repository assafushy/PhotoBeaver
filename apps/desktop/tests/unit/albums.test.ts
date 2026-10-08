import { schema } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlbumService } from '../../src/main/core/albums/album-service';
import type { EditActor } from '../../src/main/core/assets/edit-service';
import { queryLibraryPage } from '../../src/main/library/library-service';
import { insertPlugin, insertSource, openTempLibrary, type TempLibrary } from './helpers';

const ADMIN: EditActor = { userId: 'u-admin', scope: null };

describe('albums', () => {
  let temp: TempLibrary;
  let albums: AlbumService;
  const db = () => temp.library.db;
  const members = (albumId: string) =>
    db()
      .select()
      .from(schema.albumAssets)
      .where(eq(schema.albumAssets.albumId, albumId))
      .all()
      .map((r) => [r.assetId, r.position]);
  const actions = () =>
    db()
      .select()
      .from(schema.auditLog)
      .all()
      .map((a) => a.action);

  function addAsset(id: string, source: string, capturedAt: number): void {
    db().insert(schema.assets).values({ id, mediaType: 'image', capturedAt }).run();
    db()
      .insert(schema.instances)
      .values({ id: `i-${id}`, assetId: id, sourceId: source, externalId: id })
      .run();
  }

  function seedSourceAlbum(): void {
    db()
      .insert(schema.albums)
      .values({ id: 'src-album', name: 'Camera roll', sourceId: 's2' })
      .run();
    db().insert(schema.albumAssets).values({ albumId: 'src-album', assetId: 'b1' }).run();
  }

  beforeEach(async () => {
    temp = await openTempLibrary();
    insertPlugin(temp, 'conn');
    insertSource(temp, { id: 's1', pluginId: 'conn' });
    insertSource(temp, { id: 's2', pluginId: 'conn' });
    db().insert(schema.users).values({ id: 'u-kid', displayName: 'Kid', role: 'viewer' }).run();
    addAsset('a1', 's1', 3);
    addAsset('a2', 's1', 2);
    addAsset('b1', 's2', 1);
    seedSourceAlbum();
    albums = new AlbumService({ db: db(), events: { emit: () => undefined } });
  });

  afterEach(() => temp.cleanup());

  it('creates, renames, fills and deletes a user album', () => {
    const album = albums.create(ADMIN, 'Family');
    expect(album).toMatchObject({ name: 'Family', sourceId: null, count: 0, coverAssetId: null });
    albums.addAssets(ADMIN, album.id, ['a1', 'a2']);
    albums.addAssets(ADMIN, album.id, ['a2', 'b1']);
    expect(members(album.id)).toEqual([
      ['a1', 0],
      ['a2', 1],
      ['b1', 2],
    ]);
    albums.rename(ADMIN, album.id, 'Fam');
    albums.removeAssets(ADMIN, album.id, ['a1']);
    const listed = albums.list(null).find((a) => a.id === album.id);
    expect(listed).toMatchObject({ name: 'Fam', count: 2, coverAssetId: 'a2' });
    albums.delete(ADMIN, album.id);
    expect(albums.list(null).map((a) => a.id)).toEqual(['src-album']);
    expect(members(album.id)).toEqual([]);
    expect(actions()).toEqual([
      'album.create',
      'album.add',
      'album.add',
      'album.rename',
      'album.remove',
      'album.delete',
    ]);
  });

  it('narrows the library to an album with the albumIds filter', () => {
    const album = albums.create(ADMIN, 'Family');
    albums.addAssets(ADMIN, album.id, ['b1', 'a2']);
    const filter = { albumIds: [album.id] };
    const page = queryLibraryPage(db(), { cursor: null, limit: 100, filter }, null);
    expect(page.items.map((i) => i.id)).toEqual(['a2', 'b1']);
  });

  it('keeps source albums read-only', () => {
    expect(() => albums.rename(ADMIN, 'src-album', 'x')).toThrow('read-only');
    expect(() => albums.delete(ADMIN, 'src-album')).toThrow('read-only');
    expect(() => albums.addAssets(ADMIN, 'src-album', ['a1'])).toThrow('read-only');
    expect(albums.list(null)).toEqual([
      expect.objectContaining({ id: 'src-album', sourceName: 's2', count: 1, coverAssetId: 'b1' }),
    ]);
  });

  it('lists only albums in scope, counting only visible assets', () => {
    const family = albums.create(ADMIN, 'Family');
    const other = albums.create(ADMIN, 'Other');
    albums.addAssets(ADMIN, family.id, ['a1', 'b1']);
    const bySource = { sourceIds: ['s1'], albumIds: [] };
    expect(albums.list(bySource)).toEqual([]);
    const byAlbum = { sourceIds: ['s1'], albumIds: [family.id] };
    expect(albums.list(byAlbum)).toEqual([
      expect.objectContaining({ id: family.id, count: 2, coverAssetId: 'a1' }),
    ]);
    expect(albums.list({ sourceIds: ['s2'], albumIds: [] }).map((a) => a.id)).toEqual([
      'src-album',
    ]);
    expect(albums.list(null).map((a) => a.id)).toEqual([family.id, other.id, 'src-album']);
  });

  it('refuses scoped users on albums or assets they cannot see', () => {
    const family = albums.create(ADMIN, 'Family');
    const kid: EditActor = { userId: 'u-kid', scope: { sourceIds: ['s1'], albumIds: [family.id] } };
    expect(() => albums.addAssets(kid, family.id, ['b1'])).toThrow('Not found');
    albums.addAssets(kid, family.id, ['a1']);
    const outsider: EditActor = { userId: 'u-kid', scope: { sourceIds: ['s1'], albumIds: [] } };
    expect(() => albums.rename(outsider, family.id, 'x')).toThrow('Not found');
    expect(() => albums.delete(outsider, family.id)).toThrow('Not found');
  });

  it('adds an album a scoped user creates to their scope', () => {
    const kid: EditActor = { userId: 'u-kid', scope: { sourceIds: ['s1'], albumIds: [] } };
    const album = albums.create(kid, 'Mine');
    const scopes = db().select().from(schema.userScopes).all();
    expect(scopes).toEqual([{ userId: 'u-kid', scopeType: 'album', scopeId: album.id }]);
    albums.delete(ADMIN, album.id);
    expect(db().select().from(schema.userScopes).all()).toEqual([]);
  });
});
