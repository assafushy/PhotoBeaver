import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { schema } from '@photobeaver/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccessScope } from '../../src/main/core/access/scope';
import { getAssetDetail, instanceExternalUrl } from '../../src/main/core/assets/asset-service';
import { DuplicatesService } from '../../src/main/core/enrich/duplicates-service';
import type { MergeService } from '../../src/main/core/enrich/merge-service';
import { refreshSearchText } from '../../src/main/core/enrich/search-text';
import { faceCropPath } from '../../src/main/core/faces/face-crop';
import { FaceVectors } from '../../src/main/core/faces/face-vectors';
import { PeopleService } from '../../src/main/core/faces/people-service';
import { JobQueue } from '../../src/main/core/jobs/job-queue';
import { SourceService, type SourceServiceDeps } from '../../src/main/core/sources/source-service';
import { thumbPath } from '../../src/main/core/thumbnails/thumb-paths';
import { geoPoints, libraryFacets } from '../../src/main/library/facets';
import { queryLibraryPage } from '../../src/main/library/library-service';
import { handleMediaRequest, type MediaProtocolDeps } from '../../src/main/protocol/media-request';
import {
  insertPlugin,
  insertSource,
  openTempLibrary,
  userWithRole,
  type TempLibrary,
} from './helpers';

const ulid = (suffix: string) => `01K6P4J2Z9X8W7V6T5S4R3Q${suffix}`;
const A1 = ulid('AA1');
const A2 = ulid('AA2');
const B1 = ulid('BB1');
const B2 = ulid('BB2');
const B3 = ulid('BB3');
const FACE_A1 = ulid('FA1');
const FACE_B1 = ulid('FB1');
const FACE_B2 = ulid('FB2');

const FAMILY: AccessScope = { sourceIds: [], albumIds: ['family'] };
const SOURCE_A: AccessScope = { sourceIds: ['A'], albumIds: [] };

interface SeedAsset {
  id: string;
  source: string;
  file: string;
  at: number;
  lat?: number;
}

const SEED: SeedAsset[] = [
  { id: A1, source: 'A', file: 'sunset.jpg', at: 500, lat: 48.8 },
  { id: A2, source: 'A', file: 'garden.jpg', at: 400 },
  { id: B1, source: 'B', file: 'family-beach.jpg', at: 300, lat: 32.1 },
  { id: B2, source: 'B', file: 'secret-party.jpg', at: 200, lat: 40.7 },
  { id: B3, source: 'B', file: 'notes.jpg', at: 100 },
];

function insertAsset(temp: TempLibrary, asset: SeedAsset): void {
  const db = temp.library.db;
  db.insert(schema.assets)
    .values({
      id: asset.id,
      mediaType: 'image',
      capturedAt: asset.at,
      lat: asset.lat ?? null,
      lon: asset.lat === undefined ? null : 2,
    })
    .run();
  insertInstance(temp, asset.id, asset.source, asset.file);
}

function insertInstance(temp: TempLibrary, assetId: string, sourceId: string, file: string): void {
  temp.library.db
    .insert(schema.instances)
    .values({
      id: `i-${assetId}-${sourceId}`,
      assetId,
      sourceId,
      externalId: `${sourceId}/${file}`,
      path: `/photos/${sourceId}/${file}`,
      externalUrl: `https://example.test/${sourceId}/${file}`,
      sourceMetadataJson: JSON.stringify({ filename: file }),
    })
    .run();
}

function seedTags(temp: TempLibrary): void {
  const db = temp.library.db;
  db.insert(schema.tags)
    .values([
      { id: 't-paris', name: 'Paris', kind: 'place' },
      { id: 't-beach', name: 'beach', kind: 'user' },
      { id: 't-party', name: 'party', kind: 'auto' },
    ])
    .run();
  db.insert(schema.assetTags)
    .values([
      { assetId: A1, tagId: 't-paris' },
      { assetId: B2, tagId: 't-paris' },
      { assetId: B1, tagId: 't-beach' },
      { assetId: B2, tagId: 't-party' },
    ])
    .run();
}

function seedPeople(temp: TempLibrary): void {
  const db = temp.library.db;
  db.insert(schema.people)
    .values([
      { id: 'p-ada', name: 'Ada', coverFaceId: FACE_A1 },
      { id: 'p-bob', name: 'Bob' },
    ])
    .run();
  const box = JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  db.insert(schema.faces)
    .values([
      { id: FACE_A1, assetId: A1, personId: 'p-ada', bboxJson: box },
      { id: FACE_B1, assetId: B1, personId: 'p-ada', bboxJson: box },
      { id: FACE_B2, assetId: B2, personId: 'p-bob', bboxJson: box },
    ])
    .run();
}

function seedDuplicatesAndMerges(temp: TempLibrary): void {
  const db = temp.library.db;
  const suggestion = (id: string, ids: string[]) => ({
    id,
    pluginId: 'dup',
    assetIdsJson: JSON.stringify(ids),
    kind: 'near' as const,
    createdAt: 1,
  });
  db.insert(schema.duplicateSuggestions)
    .values([suggestion('d-ab', [A2, B2]), suggestion('d-aa', [A1, A2])])
    .run();
  const merge = (id: string, survivor: string) => ({
    id,
    survivingAssetId: survivor,
    mergedAssetId: `${survivor}-gone`,
    movedInstanceIdsJson: '[]',
    mergedBy: 'user',
    createdAt: 1,
  });
  db.insert(schema.assetMerges)
    .values([merge('m-a1', A1), merge('m-b2', B2)])
    .run();
}

function seedLibrary(temp: TempLibrary): void {
  insertPlugin(temp, 'p');
  insertSource(temp, { id: 'A', pluginId: 'p' });
  insertSource(temp, { id: 'B', pluginId: 'p' });
  SEED.forEach((asset) => insertAsset(temp, asset));
  insertInstance(temp, A1, 'B', 'sunset-copy.jpg');
  temp.library.db.insert(schema.albums).values({ id: 'family', name: 'Family' }).run();
  temp.library.db.insert(schema.albumAssets).values({ albumId: 'family', assetId: B1 }).run();
  seedTags(temp);
  seedPeople(temp);
  seedDuplicatesAndMerges(temp);
  SEED.forEach((asset) => refreshSearchText(temp.library.db, asset.id));
}

describe('scope matrix (SPEC 3.3)', () => {
  let temp: TempLibrary;
  let people: PeopleService;
  let duplicates: DuplicatesService;
  let sources: SourceService;
  const db = () => temp.library.db;
  const ids = (scope: AccessScope | null, filter: object = {}) =>
    queryLibraryPage(db(), { cursor: null, limit: 100, filter }, scope);

  beforeEach(async () => {
    temp = await openTempLibrary();
    seedLibrary(temp);
    people = new PeopleService({
      db: db(),
      vectors: new FaceVectors(temp.library.sqlite),
      queue: new JobQueue(temp.library.sqlite),
      events: { emit: () => undefined },
      clusterParams: () => ({ maxDistance: 0.5, minFaces: 3 }),
    });
    duplicates = new DuplicatesService(
      db(),
      {} as MergeService,
      { emit: () => undefined },
      () => 1,
    );
    const registry = { get: () => undefined } as unknown as SourceServiceDeps['registry'];
    sources = new SourceService({ db: db(), registry } as SourceServiceDeps);
  });

  afterEach(() => temp.cleanup());

  it('limits the library query, totals, search and the albumIds filter', () => {
    const page = (scope: AccessScope | null, filter?: object) =>
      ids(scope, filter).items.map((i) => i.id);
    expect(page(null)).toEqual([A1, A2, B1, B2, B3]);
    expect(ids(null).total).toBe(5);
    expect(page(FAMILY)).toEqual([B1]);
    expect(ids(FAMILY).total).toBe(1);
    expect(page(SOURCE_A)).toEqual([A1, A2]);
    expect(ids(SOURCE_A).total).toBe(2);
    expect(page(null, { text: 'secret' })).toEqual([B2]);
    expect(page(FAMILY, { text: 'secret' })).toEqual([]);
    expect(page(SOURCE_A, { text: 'secret' })).toEqual([]);
    expect(ids(SOURCE_A, { text: 'secret' }).total).toBe(0);
    expect(page(FAMILY, { text: 'beach' })).toEqual([B1]);
    expect(page(null, { albumIds: ['family'] })).toEqual([B1]);
    expect(page(SOURCE_A, { albumIds: ['family'] })).toEqual([]);
  });

  it('limits map points', () => {
    const points = (scope: AccessScope | null) =>
      geoPoints(db(), {}, scope).points.map(([id]) => id);
    expect(points(null)).toEqual(expect.arrayContaining([A1, B1, B2]));
    expect(points(FAMILY)).toEqual([B1]);
    expect(points(SOURCE_A)).toEqual([A1]);
  });

  it('limits every facet', () => {
    const pairs = (list: { name: string; count: number }[]) => list.map((f) => [f.name, f.count]);
    const all = libraryFacets(db(), null);
    expect(pairs(all.sources)).toEqual([
      ['A', 2],
      ['B', 4],
    ]);
    expect(pairs(all.places)).toEqual([['Paris', 2]]);
    expect(pairs(all.people)).toEqual([
      ['Ada', 2],
      ['Bob', 1],
    ]);
    const family = libraryFacets(db(), FAMILY);
    expect(family).toMatchObject({ sources: [], places: [], people: [{ name: 'Ada', count: 1 }] });
    expect(pairs(family.tags)).toEqual([['beach', 1]]);
    const sourceA = libraryFacets(db(), SOURCE_A);
    expect(pairs(sourceA.sources)).toEqual([['A', 2]]);
    expect(pairs(sourceA.places)).toEqual([['Paris', 1]]);
    expect(sourceA.tags).toEqual([]);
    expect(pairs(sourceA.people)).toEqual([['Ada', 1]]);
  });

  it('limits people, their faces and covers', () => {
    expect(people.list(null).map((p) => [p.name, p.faceCount, p.coverFaceId])).toEqual([
      ['Ada', 2, FACE_A1],
      ['Bob', 1, FACE_B2],
    ]);
    expect(people.list(FAMILY).map((p) => [p.name, p.faceCount, p.coverFaceId])).toEqual([
      ['Ada', 1, FACE_B1],
    ]);
    expect(people.list(SOURCE_A).map((p) => [p.name, p.assetCount, p.coverFaceId])).toEqual([
      ['Ada', 1, FACE_A1],
    ]);
    expect(people.faces('p-ada', null, FAMILY).items.map((f) => f.id)).toEqual([FACE_B1]);
    expect(people.faces('p-bob', null, FAMILY).items).toEqual([]);
    expect(people.faces('p-ada', null, null).items).toHaveLength(2);
  });

  it('refuses people edits outside the scope', () => {
    expect(() => people.rename('p-bob', 'Robert', FAMILY)).toThrow('Person not found');
    expect(() => people.merge('p-bob', 'p-ada', FAMILY)).toThrow('Person not found');
    expect(() => people.setCover('p-ada', FACE_A1, FAMILY)).toThrow('Face not found');
    expect(() => people.rejectFace(FACE_B2, SOURCE_A)).toThrow('Face not found');
    expect(() => people.moveFaces([FACE_A1], { newPerson: true }, FAMILY)).toThrow(
      'Face not found',
    );
    expect(() => people.moveFaces([FACE_B1], { personId: 'p-bob' }, FAMILY)).toThrow(
      'Person not found',
    );
    people.rename('p-ada', 'Ada L', FAMILY);
    expect(people.list(null)[0]!.name).toBe('Ada L');
  });

  it('limits duplicates and recent merges, and refuses acting on hidden ones', () => {
    expect(duplicates.list(null).map((g) => g.id)).toEqual(['d-ab', 'd-aa']);
    expect(duplicates.list(FAMILY)).toEqual([]);
    expect(duplicates.list(SOURCE_A).map((g) => g.id)).toEqual(['d-aa']);
    expect(
      duplicates
        .recentMerges(null)
        .map((m) => m.id)
        .sort(),
    ).toEqual(['m-a1', 'm-b2']);
    expect(duplicates.recentMerges(FAMILY)).toEqual([]);
    expect(duplicates.recentMerges(SOURCE_A).map((m) => m.id)).toEqual(['m-a1']);
    expect(() => duplicates.merge('d-ab', A2, 'u', SOURCE_A)).toThrow('no longer open');
    expect(() => duplicates.dismiss('d-ab', 'u', SOURCE_A)).toThrow('no longer open');
    expect(() => duplicates.undo('m-b2', 'u', SOURCE_A)).toThrow('Merge not found');
    duplicates.dismiss('d-aa', 'u', SOURCE_A);
    expect(duplicates.list(null).map((g) => g.id)).toEqual(['d-ab']);
  });

  it('hides out-of-scope assets and instances in the detail', () => {
    expect(() => getAssetDetail(db(), B2, FAMILY)).toThrow(`Asset not found: ${B2}`);
    expect(() => getAssetDetail(db(), B1, SOURCE_A)).toThrow(`Asset not found: ${B1}`);
    expect(getAssetDetail(db(), A1, null).instances.map((i) => i.sourceId)).toEqual(['A', 'B']);
    expect(getAssetDetail(db(), A1, SOURCE_A).instances.map((i) => i.sourceId)).toEqual(['A']);
    const viaAlbum = getAssetDetail(db(), B1, FAMILY);
    expect(viaAlbum.instances).toEqual([
      expect.objectContaining({ sourceName: 'B', path: null, canOpen: false }),
    ]);
    expect(viaAlbum).toMatchObject({
      hidden: false,
      albums: [{ id: 'family', name: 'Family', user: true }],
    });
    expect(getAssetDetail(db(), B1, { sourceIds: ['B'], albumIds: [] }).albums).toEqual([]);
  });

  it('refuses open in source outside the scope', () => {
    expect(instanceExternalUrl(db(), `i-${A1}-A`, SOURCE_A)).toContain('/A/');
    expect(instanceExternalUrl(db(), `i-${A1}-B`, SOURCE_A)).toBeNull();
    expect(instanceExternalUrl(db(), `i-${B1}-B`, FAMILY)).toBeNull();
    expect(instanceExternalUrl(db(), `i-${B2}-B`, null)).toContain('/B/');
  });

  it('lists only visible sources', () => {
    expect(sources.list(null).map((s) => s.id)).toEqual(['A', 'B']);
    expect(sources.list(SOURCE_A).map((s) => s.id)).toEqual(['A']);
    expect(sources.list(FAMILY)).toEqual([]);
  });
});

describe('pb-media scope checks', () => {
  let temp: TempLibrary;
  let scope: AccessScope | null;
  let deps: MediaProtocolDeps;
  const get = async (url: string) => (await handleMediaRequest(deps, new Request(url))).status;

  function cacheFiles(thumbsDir: string): void {
    for (const assetId of [A1, B1, B2]) {
      const file = thumbPath(thumbsDir, assetId, 256);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'webp');
    }
    for (const faceId of [FACE_A1, FACE_B1]) {
      mkdirSync(path.dirname(faceCropPath(thumbsDir, faceId)), { recursive: true });
      writeFileSync(faceCropPath(thumbsDir, faceId), 'webp');
    }
  }

  beforeEach(async () => {
    temp = await openTempLibrary();
    seedLibrary(temp);
    scope = FAMILY;
    const thumbsDir = path.join(temp.dir, 'thumbs');
    cacheFiles(thumbsDir);
    const fail = () => Promise.reject(new Error('must not load an original'));
    deps = {
      db: temp.library.db,
      core: { queue: { enqueue: () => true }, originals: { ensureLocal: fail } },
      thumbsDir,
      session: { current: () => userWithRole('viewer'), scope: () => scope },
    };
  });

  afterEach(() => temp.cleanup());

  it('serves in-scope media and answers 404 for anything outside the scope', async () => {
    expect(await get(`pb-media://thumb/${B1}/256`)).toBe(200);
    expect(await get(`pb-media://face/${FACE_B1}`)).toBe(200);
    expect(await get(`pb-media://thumb/${B2}/256`)).toBe(404);
    expect(await get(`pb-media://thumb/${A1}/256`)).toBe(404);
    expect(await get(`pb-media://face/${FACE_A1}`)).toBe(404);
    expect(await get(`pb-media://original/${B2}`)).toBe(404);
    scope = null;
    expect(await get(`pb-media://thumb/${A1}/256`)).toBe(200);
    expect(await get(`pb-media://face/${FACE_A1}`)).toBe(200);
  });

  it('answers 403 when locked', async () => {
    deps.session = { current: () => null, scope: () => null };
    expect(await get(`pb-media://thumb/${B1}/256`)).toBe(403);
  });
});
