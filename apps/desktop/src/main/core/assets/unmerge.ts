import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { refreshMissing } from './missing';
import {
  MERGEABLE_FIELDS,
  type AddedToSurvivor,
  type MergeSnapshot,
  type MergeableFields,
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

type MergeRow = typeof assetMerges.$inferSelect;

function loadMerge(db: LibraryDb, mergeId: string): MergeRow {
  const row = db
    .select()
    .from(assetMerges)
    .where(and(eq(assetMerges.id, mergeId), isNull(assetMerges.undoneAt)))
    .get();
  if (!row?.snapshotJson) throw new Error(`No undoable merge: ${mergeId}`);
  const survivor = db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, row.survivingAssetId))
    .get();
  if (!survivor) throw new Error('The surviving asset was merged again; undo that merge first');
  return row;
}

function restoreMergedAsset(db: LibraryDb, snapshot: MergeSnapshot, row: MergeRow): void {
  const m = snapshot.mergedMemberships;
  db.insert(assets).values(snapshot.merged).run();
  const movedIds = JSON.parse(row.movedInstanceIdsJson) as string[];
  if (movedIds.length > 0) {
    db.update(instances)
      .set({ assetId: row.mergedAssetId })
      .where(and(inArray(instances.id, movedIds), eq(instances.assetId, row.survivingAssetId)))
      .run();
  }
  if (m.faceIds.length > 0)
    db.update(faces).set({ assetId: row.mergedAssetId }).where(inArray(faces.id, m.faceIds)).run();
  for (const link of m.albums) db.insert(albumAssets).values(link).onConflictDoNothing().run();
  for (const link of m.tags) db.insert(assetTags).values(link).onConflictDoNothing().run();
  for (const r of m.enrichments) db.insert(enrichments).values(r).onConflictDoNothing().run();
  for (const r of m.identity) db.insert(assetIdentity).values(r).onConflictDoNothing().run();
}

function removeAddedMemberships(db: LibraryDb, survivorId: string, added: AddedToSurvivor): void {
  for (const albumId of added.albumIds) {
    db.delete(albumAssets)
      .where(and(eq(albumAssets.assetId, survivorId), eq(albumAssets.albumId, albumId)))
      .run();
  }
  for (const tagId of added.tagIds) {
    db.delete(assetTags)
      .where(and(eq(assetTags.assetId, survivorId), eq(assetTags.tagId, tagId)))
      .run();
  }
}

function removeAddedEnrichments(db: LibraryDb, survivorId: string, added: AddedToSurvivor): void {
  for (const { pluginId, key } of added.enrichmentKeys) {
    db.delete(enrichments)
      .where(
        and(
          eq(enrichments.assetId, survivorId),
          eq(enrichments.pluginId, pluginId),
          eq(enrichments.key, key),
        ),
      )
      .run();
  }
}

function removeAddedIdentity(db: LibraryDb, survivorId: string, added: AddedToSurvivor): void {
  for (const { pluginId, key } of added.identityKeys) {
    db.delete(assetIdentity)
      .where(
        and(
          eq(assetIdentity.assetId, survivorId),
          eq(assetIdentity.pluginId, pluginId),
          eq(assetIdentity.key, key),
        ),
      )
      .run();
  }
}

function removeAddedLinks(db: LibraryDb, survivorId: string, added: AddedToSurvivor): void {
  removeAddedMemberships(db, survivorId, added);
  removeAddedEnrichments(db, survivorId, added);
  removeAddedIdentity(db, survivorId, added);
}

function restoreSurvivorFields(
  db: LibraryDb,
  survivorId: string,
  snapshot: MergeSnapshot,
  now: number,
): void {
  const current = db.select().from(assets).where(eq(assets.id, survivorId)).get()!;
  const patch: Partial<MergeableFields> = {};
  for (const field of MERGEABLE_FIELDS) {
    if (current[field] === snapshot.survivorAfter[field]) {
      (patch as Record<string, unknown>)[field] = snapshot.survivorBefore[field];
    }
  }
  db.update(assets)
    .set({ ...patch, updatedAt: now })
    .where(eq(assets.id, survivorId))
    .run();
}

/**
 * Undoes a merge (SPEC 4.3 step 5): restores the merged asset with its instances,
 * albums, tags, faces, enrichments and identity keys, and reverts survivor fields
 * the merge changed unless the user edited them since. The pair then counts as
 * "never merge".
 *
 * @param db - Library database.
 * @param mergeId - The asset_merges row id.
 * @param now - Current time.
 * @returns The ids of the two assets.
 */
export function unmergeAssets(
  db: LibraryDb,
  mergeId: string,
  now: number,
): { survivingAssetId: string; restoredAssetId: string } {
  return db.transaction((txRaw) => {
    const tx = txRaw as unknown as LibraryDb;
    const row = loadMerge(tx, mergeId);
    const snapshot = JSON.parse(row.snapshotJson!) as MergeSnapshot;
    restoreMergedAsset(tx, snapshot, row);
    removeAddedLinks(tx, row.survivingAssetId, snapshot.added);
    restoreSurvivorFields(tx, row.survivingAssetId, snapshot, now);
    tx.update(assetMerges).set({ undoneAt: now }).where(eq(assetMerges.id, mergeId)).run();
    refreshMissing(tx, [row.survivingAssetId, row.mergedAssetId], now);
    return { survivingAssetId: row.survivingAssetId, restoredAssetId: row.mergedAssetId };
  });
}
