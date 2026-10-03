import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { ulid } from 'ulid';
import { refreshMissing } from './missing';
import {
  combinedFields,
  diffAdded,
  mergeableFields,
  readMemberships,
  type AssetRow,
  type MergeSnapshot,
} from './merge-snapshot';

const {
  assets,
  instances,
  faces,
  albumAssets,
  assetTags,
  enrichments,
  assetIdentity,
  assetMerges,
} = schema;

export interface MergeResult {
  mergeId: string;
  survivingAssetId: string;
  mergedAssetId: string;
}

function loadAsset(db: LibraryDb, id: string): AssetRow {
  const row = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!row) throw new Error(`Asset not found: ${id}`);
  return row;
}

function orderBySurvival(a: AssetRow, b: AssetRow): [AssetRow, AssetRow] {
  const aFirst =
    (a.createdAt ?? 0) < (b.createdAt ?? 0) ||
    ((a.createdAt ?? 0) === (b.createdAt ?? 0) && a.id < b.id);
  return aFirst ? [a, b] : [b, a];
}

function copyMemberships(db: LibraryDb, snapshot: MergeSnapshot, survivorId: string): void {
  const m = snapshot.mergedMemberships;
  for (const link of m.albums)
    db.insert(albumAssets)
      .values({ ...link, assetId: survivorId })
      .onConflictDoNothing()
      .run();
  for (const link of m.tags)
    db.insert(assetTags)
      .values({ ...link, assetId: survivorId })
      .onConflictDoNothing()
      .run();
}

function copyPluginData(db: LibraryDb, snapshot: MergeSnapshot, survivorId: string): void {
  const m = snapshot.mergedMemberships;
  for (const row of m.enrichments)
    db.insert(enrichments)
      .values({ ...row, assetId: survivorId })
      .onConflictDoNothing()
      .run();
  for (const row of m.identity)
    db.insert(assetIdentity)
      .values({ ...row, assetId: survivorId })
      .onConflictDoNothing()
      .run();
}

function copyLinks(db: LibraryDb, snapshot: MergeSnapshot, survivorId: string): void {
  copyMemberships(db, snapshot, survivorId);
  copyPluginData(db, snapshot, survivorId);
}

function moveInstances(db: LibraryDb, fromId: string, toId: string): string[] {
  const moved = db
    .update(instances)
    .set({ assetId: toId })
    .where(eq(instances.assetId, fromId))
    .returning({ id: instances.id })
    .all();
  db.update(faces).set({ assetId: toId }).where(eq(faces.assetId, fromId)).run();
  return moved.map((row) => row.id);
}

function buildSnapshot(db: LibraryDb, survivor: AssetRow, merged: AssetRow): MergeSnapshot {
  const mergedMemberships = readMemberships(db, merged.id);
  return {
    merged,
    mergedMemberships,
    added: diffAdded(mergedMemberships, readMemberships(db, survivor.id)),
    survivorBefore: mergeableFields(survivor),
    survivorAfter: combinedFields(survivor, merged),
  };
}

interface MergeRecord {
  survivor: AssetRow;
  merged: AssetRow;
  snapshot: MergeSnapshot;
  movedIds: string[];
  mergedBy: string;
}

function applyToSurvivor(db: LibraryDb, record: MergeRecord, now: number): void {
  const { survivor, merged, snapshot } = record;
  copyLinks(db, snapshot, survivor.id);
  db.update(assets)
    .set({ ...snapshot.survivorAfter, updatedAt: now })
    .where(eq(assets.id, survivor.id))
    .run();
  db.delete(assets).where(eq(assets.id, merged.id)).run();
}

function recordMerge(db: LibraryDb, record: MergeRecord, now: number): string {
  const mergeId = ulid(now);
  db.insert(assetMerges)
    .values({
      id: mergeId,
      survivingAssetId: record.survivor.id,
      mergedAssetId: record.merged.id,
      movedInstanceIdsJson: JSON.stringify(record.movedIds),
      mergedBy: record.mergedBy,
      snapshotJson: JSON.stringify(record.snapshot),
      createdAt: now,
    })
    .run();
  return mergeId;
}

/**
 * Merges two assets that are the same media (SPEC 4.3 step 4), in one transaction.
 * The older asset survives; instances, albums, tags, faces and user flags move to
 * it, its enrichments win and gaps are filled from the merged asset.
 *
 * @param db - Library database.
 * @param assetA - One asset id.
 * @param assetB - The other asset id.
 * @param mergedBy - Plugin id or 'user'.
 * @param now - Current time.
 * @returns The merge id and which asset survived.
 */
export function mergeAssets(
  db: LibraryDb,
  assetA: string,
  assetB: string,
  mergedBy: string,
  now: number,
): MergeResult {
  if (assetA === assetB) throw new Error('Cannot merge an asset with itself');
  return db.transaction((txRaw) => {
    const tx = txRaw as unknown as LibraryDb;
    const [survivor, merged] = orderBySurvival(loadAsset(tx, assetA), loadAsset(tx, assetB));
    const snapshot = buildSnapshot(tx, survivor, merged);
    const movedIds = moveInstances(tx, merged.id, survivor.id);
    const record: MergeRecord = { survivor, merged, snapshot, movedIds, mergedBy };
    applyToSurvivor(tx, record, now);
    const mergeId = recordMerge(tx, record, now);
    refreshMissing(tx, [survivor.id], now);
    return { mergeId, survivingAssetId: survivor.id, mergedAssetId: merged.id };
  });
}

/**
 * True if the user undid a merge of these two assets before ("never merge" list).
 *
 * @param db - Library database.
 * @param a - Asset id.
 * @param b - Asset id.
 * @returns Whether merging them is blocked.
 */
export function isMergeBlocked(db: LibraryDb, a: string, b: string): boolean {
  const pair = (x: string, y: string) =>
    and(eq(assetMerges.survivingAssetId, x), eq(assetMerges.mergedAssetId, y));
  const row = db
    .select({ id: assetMerges.id })
    .from(assetMerges)
    .where(and(isNotNull(assetMerges.undoneAt), or(pair(a, b), pair(b, a))))
    .get();
  return row !== undefined;
}
