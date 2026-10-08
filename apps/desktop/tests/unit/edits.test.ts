import { schema } from '@photobeaver/db';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditService, type EditActor } from '../../src/main/core/assets/edit-service';
import { applyEnrichmentResult } from '../../src/main/core/enrich/apply-result';
import { EnrichScheduler } from '../../src/main/core/enrich/enrich-scheduler';
import { EnricherRegistry } from '../../src/main/core/enrich/enricher-registry';
import type { EnricherEntry } from '../../src/main/core/enrich/types';
import { FaceStore } from '../../src/main/core/faces/face-store';
import { FaceVectors } from '../../src/main/core/faces/face-vectors';
import { JobQueue } from '../../src/main/core/jobs/job-queue';
import { queryLibraryPage } from '../../src/main/library/library-service';
import { refreshSearchText } from '../../src/main/core/enrich/search-text';
import { insertPlugin, insertSource, openTempLibrary, type TempLibrary } from './helpers';

const ADMIN: EditActor = { userId: 'u-admin', scope: null };
const SCOPED: EditActor = { userId: 'u-kid', scope: { sourceIds: ['s1'], albumIds: [] } };
const EXIF = 'com.photobeaver.enricher-exif';

const enricher: EnricherEntry = {
  manifest: {
    id: EXIF,
    name: 'EXIF',
    version: '1.0.0',
    permissions: { originals: 'read', assets: 'none' },
    enricher: {
      accepts: ['image/*'],
      input: 'metadata',
      dependsOn: [],
      produces: [],
      concurrency: 1,
      resourceClass: 'light',
    },
  },
  client: { enrich: async () => ({ skipped: true }) },
};

describe('asset edits', () => {
  let temp: TempLibrary;
  let queue: JobQueue;
  let edits: EditService;
  let emitted: number;
  const db = () => temp.library.db;
  const asset = (id: string) =>
    db().select().from(schema.assets).where(eq(schema.assets.id, id)).get()!;
  const search = (text: string) =>
    queryLibraryPage(db(), { cursor: null, limit: 100, filter: { text } }, null).items.map(
      (i) => i.id,
    );
  const library = () =>
    queryLibraryPage(db(), { cursor: null, limit: 100, filter: {} }, null).items.map((i) => i.id);
  const audit = () => db().select().from(schema.auditLog).all();

  function addAsset(id: string, source: string, file: string): void {
    db().insert(schema.assets).values({ id, mediaType: 'image', mime: 'image/jpeg' }).run();
    db()
      .insert(schema.instances)
      .values({
        id: `i-${id}`,
        assetId: id,
        sourceId: source,
        externalId: file,
        sourceMetadataJson: JSON.stringify({ filename: file }),
      })
      .run();
    refreshSearchText(db(), id);
  }

  beforeEach(async () => {
    temp = await openTempLibrary();
    insertPlugin(temp, 'conn');
    insertSource(temp, { id: 's1', pluginId: 'conn' });
    insertSource(temp, { id: 's2', pluginId: 'conn' });
    addAsset('a1', 's1', 'IMG_20200101_101010.jpg');
    addAsset('a2', 's2', 'beach.jpg');
    queue = new JobQueue(temp.library.sqlite);
    const registry = new EnricherRegistry();
    registry.add(enricher);
    const scheduler = new EnrichScheduler(db(), queue, registry);
    emitted = 0;
    edits = new EditService({
      db: db(),
      events: { emit: () => void emitted++ },
      replan: (ids) => scheduler.contentChanged(ids),
    });
  });

  afterEach(() => temp.cleanup());

  it('sets favorite and audits with a count', () => {
    edits.setFavorite(ADMIN, ['a1', 'a2'], true);
    expect(asset('a1').favorite).toBe(1);
    expect(asset('a2').favorite).toBe(1);
    expect(emitted).toBe(1);
    const [entry] = audit();
    expect(entry).toMatchObject({ action: 'asset.favorite', userId: 'u-admin' });
    expect(JSON.parse(entry!.detailsJson!)).toMatchObject({ count: 2, favorite: true });
  });

  it('hides assets from the library query', () => {
    edits.setHidden(ADMIN, ['a2'], true);
    expect(library()).toEqual(['a1']);
    edits.setHidden(ADMIN, ['a2'], false);
    expect(library().sort()).toEqual(['a1', 'a2']);
  });

  it('adds user tags that are searchable and removes them', () => {
    edits.addTag(ADMIN, ['a1', 'a2'], 'Vacation');
    edits.addTag(ADMIN, ['a1'], 'Vacation');
    const tags = db().select().from(schema.tags).all();
    expect(tags).toEqual([expect.objectContaining({ name: 'Vacation', kind: 'user' })]);
    expect(db().select().from(schema.assetTags).all()).toHaveLength(2);
    expect(search('vacation').sort()).toEqual(['a1', 'a2']);
    edits.removeTag(ADMIN, ['a1', 'a2'], 'Vacation');
    expect(search('vacation')).toEqual([]);
    expect(db().select().from(schema.tags).all()).toEqual([]);
    expect(audit().map((a) => a.action)).toEqual(['asset.tag', 'asset.tag', 'asset.untag']);
  });

  it('keeps a user date over EXIF and falls back when cleared', () => {
    const userDate = Date.UTC(1999, 4, 5, 6, 7);
    edits.setCapturedAt(ADMIN, 'a1', userDate);
    applyEnrichmentResult(
      {
        db: db(),
        assetId: 'a1',
        pluginId: EXIF,
        pluginVersion: '1.0.0',
        rank: 'exif',
        canMerge: false,
        now: 1,
        faces: new FaceStore(new FaceVectors(temp.library.sqlite)),
      },
      { capturedAt: '2021-02-03T04:05:06Z' },
    );
    expect(asset('a1')).toMatchObject({ capturedAt: userDate, capturedAtSource: 'user' });
    edits.setCapturedAt(ADMIN, 'a1', null);
    expect(asset('a1')).toMatchObject({
      capturedAt: Date.UTC(2020, 0, 1, 10, 10, 10),
      capturedAtSource: 'filename',
    });
    expect(queue.pendingFor('enrich', EXIF)).toBe(1);
  });

  it('sets and clears a user location', () => {
    edits.setLocation(ADMIN, 'a1', { lat: 10, lon: 20 });
    expect(asset('a1')).toMatchObject({ lat: 10, lon: 20, locationSource: 'user' });
    edits.setLocation(ADMIN, 'a1', null);
    expect(asset('a1')).toMatchObject({ lat: null, lon: null, locationSource: null });
    expect(audit().map((a) => a.action)).toEqual(['asset.location', 'asset.location']);
  });

  it('refuses assets outside a scoped user scope', () => {
    expect(() => edits.setFavorite(SCOPED, ['a1', 'a2'], true)).toThrow('Not found');
    expect(() => edits.addTag(SCOPED, ['a2'], 'x')).toThrow('Not found');
    expect(() => edits.setCapturedAt(SCOPED, 'a2', 1)).toThrow('Not found');
    expect(() => edits.rerun(SCOPED, ['a2'])).toThrow('Not found');
    expect(() => edits.setHidden(ADMIN, ['missing'], true)).toThrow('Not found');
    expect(asset('a1').favorite).toBe(0);
    edits.setFavorite(SCOPED, ['a1'], true);
    expect(asset('a1').favorite).toBe(1);
    expect(audit()).toHaveLength(1);
  });

  it('re-runs enrichment even when the enricher already ran', () => {
    db().run(
      sql`INSERT INTO enrichment_runs (asset_id, plugin_id, plugin_version, status, completed_at) VALUES ('a1', ${EXIF}, '1.0.0', 'done', 1)`,
    );
    edits.rerun(ADMIN, ['a1']);
    expect(queue.pendingFor('enrich', EXIF)).toBe(1);
    expect(audit().map((a) => a.action)).toEqual(['asset.rerun']);
  });
});
