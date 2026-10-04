import { schema } from '@photobeaver/db';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeAssets } from '../../src/main/core/assets/merge';
import { unmergeAssets } from '../../src/main/core/assets/unmerge';
import { refreshSearchText } from '../../src/main/core/enrich/search-text';
import { FaceStore, type DetectedFace } from '../../src/main/core/faces/face-store';
import { FaceVectors } from '../../src/main/core/faces/face-vectors';
import { faceRegion } from '../../src/main/core/faces/face-crop';
import { PeopleService } from '../../src/main/core/faces/people-service';
import { JobQueue } from '../../src/main/core/jobs/job-queue';
import { filterCondition } from '../../src/main/library/library-filter';
import { openTempLibrary, type TempLibrary } from './helpers';

const PLUGIN = 'com.photobeaver.enricher-faces';

function embedding(group: number, jitter: number): number[] {
  const v = new Array<number>(512).fill(0);
  v[group * 10] = 1;
  v[group * 10 + 1 + (jitter % 5)] = 0.15;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

const face = (group: number, jitter = 0, x = 0.1): DetectedFace => ({
  bbox: { x, y: 0.1, w: 0.2, h: 0.2 },
  confidence: 0.9,
  embedding: embedding(group, jitter),
});

describe('faces and people', () => {
  let temp: TempLibrary;
  let store: FaceStore;
  let people: PeopleService;
  const db = () => temp.library.db;
  const addAsset = (id: string, createdAt = 1) =>
    db().insert(schema.assets).values({ id, mediaType: 'image', createdAt }).run();
  const sync = (assetId: string, faces: DetectedFace[]) =>
    store.sync(db(), { assetId, pluginId: PLUGIN }, faces);
  const personOf = (faceId: string) =>
    db().select().from(schema.faces).where(eq(schema.faces.id, faceId)).get()?.personId ?? null;

  beforeEach(async () => {
    temp = await openTempLibrary();
    store = new FaceStore(new FaceVectors(temp.library.sqlite));
    people = new PeopleService({
      db: db(),
      vectors: store.vectors,
      queue: new JobQueue(temp.library.sqlite),
      events: { emit: () => undefined },
      clusterParams: () => ({ maxDistance: 0.5, minFaces: 3 }),
    });
  });

  afterEach(() => temp.cleanup());

  function seedGroups(): Record<string, string[]> {
    const ids: Record<string, string[]> = { a: [], b: [], noise: [] };
    for (let i = 0; i < 4; i++) {
      addAsset(`A${i}`);
      ids.a!.push(...sync(`A${i}`, [face(1, i)]).added);
      addAsset(`B${i}`);
      ids.b!.push(...sync(`B${i}`, [face(2, i)]).added);
    }
    addAsset('N0');
    ids.noise!.push(...sync('N0', [face(30)]).added);
    return ids;
  }

  it('keeps face ids, people and embeddings stable when an enricher re-runs', () => {
    addAsset('x');
    const [first] = sync('x', [face(1)]).added;
    db()
      .update(schema.faces)
      .set({ personId: null, assignedBy: 'user' })
      .where(eq(schema.faces.id, first!))
      .run();
    const again = sync('x', [
      { ...face(1), bbox: { x: 0.11, y: 0.1, w: 0.2, h: 0.2 } },
      face(2, 0, 0.7),
    ]);
    expect(again.kept).toEqual([first]);
    expect(again.added).toHaveLength(1);
    const gone = sync('x', [face(2, 0, 0.7)]);
    expect(gone.removed).toEqual([first]);
    expect(store.vectors.read(first!)).toBeNull();
  });

  it('groups similar faces into people and leaves lone faces alone', async () => {
    const ids = seedGroups();
    await people.runClustering();
    const a = new Set(ids.a!.map(personOf));
    const b = new Set(ids.b!.map(personOf));
    expect(a.size).toBe(1);
    expect(b.size).toBe(1);
    expect([...a][0]).not.toBe([...b][0]);
    expect(personOf(ids.noise![0]!)).toBeNull();
    expect(people.list().map((p) => p.faceCount)).toEqual([4, 4]);
  });

  it('respects user moves and rejections when clustering again', async () => {
    const ids = seedGroups();
    await people.runClustering();
    const personA = personOf(ids.a![0]!)!;
    const split = people.moveFaces([ids.a![0]!], { newPerson: true });
    people.rejectFace(ids.a![1]!);
    await people.runClustering();
    expect(personOf(ids.a![0]!)).toBe(split);
    expect(personOf(ids.a![1]!)).not.toBe(personA);
  });

  it('renames, merges and makes names searchable and filterable', async () => {
    const ids = seedGroups();
    await people.runClustering();
    const [pa, pb] = [personOf(ids.a![0]!)!, personOf(ids.b![0]!)!];
    people.rename(pa, 'Ada Lovelace');
    const hits = temp.library.sqlite
      .prepare("SELECT asset_id FROM assets_fts WHERE assets_fts MATCH 'lovelace'")
      .all();
    expect(hits).toHaveLength(4);
    people.merge(pb, pa);
    expect(people.list()).toEqual([
      expect.objectContaining({ id: pa, name: 'Ada Lovelace', faceCount: 8 }),
    ]);
    const shown = db()
      .select({ n: sql<number>`count(*)` })
      .from(schema.assets)
      .where(filterCondition({ personIds: [pa] }))
      .get()!.n;
    expect(shown).toBe(8);
  });

  it('deletes people left without faces', async () => {
    const ids = seedGroups();
    await people.runClustering();
    store.remove(db(), ids.b!);
    expect(people.cleanup()).toBe(1);
    expect(people.list()).toHaveLength(1);
  });

  it('does not double faces when merging copies of one photo, and undo restores them', async () => {
    const ids = seedGroups();
    await people.runClustering();
    addAsset('copy', 5);
    const [copyFace] = sync('copy', [face(1, 9)]).added;
    db()
      .update(schema.faces)
      .set({ personId: personOf(ids.a![0]!) })
      .where(eq(schema.faces.id, copyFace!))
      .run();
    db().update(schema.faces).set({ personId: null }).where(eq(schema.faces.id, ids.a![0]!)).run();
    const { mergeId } = mergeAssets(db(), 'A0', 'copy', 'user', 2, {
      survivorId: 'A0',
      faces: store,
    });
    const onSurvivor = db().select().from(schema.faces).where(eq(schema.faces.assetId, 'A0')).all();
    expect(onSurvivor).toHaveLength(1);
    expect(onSurvivor[0]!.personId).toBe(personOf(ids.a![1]!));
    unmergeAssets(db(), mergeId, 3, store);
    const restored = db().select().from(schema.faces).where(eq(schema.faces.assetId, 'copy')).all();
    expect(restored.map((f) => f.id)).toEqual([copyFace]);
    expect(store.vectors.read(copyFace!)).toHaveLength(512);
    refreshSearchText(db(), 'copy');
  });

  it('crops a square around a face within the image', () => {
    expect(faceRegion({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1000, 500)).toEqual({
      left: 340,
      top: 90,
      width: 320,
      height: 320,
    });
    expect(faceRegion({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }, 100, 100)).toEqual({
      left: 68,
      top: 68,
      width: 32,
      height: 32,
    });
  });
});
