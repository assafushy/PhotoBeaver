import { schema, type LibraryDb } from '@photobeaver/db';
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { removeSearchText } from '../enrich/search-text';

const { assets, instances, jobs } = schema;
const CHUNK = 500;

function deleteChunk(db: LibraryDb, ids: string[]): string[] {
  ids.forEach((id) => removeSearchText(db, id));
  db.delete(instances).where(inArray(instances.assetId, ids)).run();
  db.delete(jobs).where(inArray(jobs.assetId, ids)).run();
  return db
    .delete(assets)
    .where(inArray(assets.id, ids))
    .returning({ id: assets.id })
    .all()
    .map((r) => r.id);
}

/**
 * Deletes assets with their instances and pending jobs. Files are the caller's job.
 *
 * @param db - Database or transaction.
 * @param assetIds - Assets to delete.
 * @returns Ids actually deleted.
 */
export function deleteAssets(db: LibraryDb, assetIds: readonly string[]): string[] {
  const deleted: string[] = [];
  for (let i = 0; i < assetIds.length; i += CHUNK)
    deleted.push(...deleteChunk(db, assetIds.slice(i, i + CHUNK)));
  return deleted;
}

/**
 * Deletes candidate assets that no longer have any instance.
 *
 * @param db - Database or transaction.
 * @param candidates - Assets that may have become orphans.
 * @returns Ids deleted.
 */
export function deleteOrphanAssets(db: LibraryDb, candidates: readonly string[]): string[] {
  const orphans: string[] = [];
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const rows = db
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          inArray(assets.id, chunk),
          sql`NOT EXISTS (SELECT 1 FROM instances WHERE instances.asset_id = assets.id)`,
        ),
      )
      .all();
    orphans.push(...rows.map((r) => r.id));
  }
  return deleteAssets(db, orphans);
}

/**
 * Selects assets that have been missing since before the cutoff (SPEC 4.3: 30 days).
 *
 * @param db - Database.
 * @param cutoff - Timestamp; older missing assets are purged.
 * @returns Asset ids.
 */
export function expiredMissingAssets(db: LibraryDb, cutoff: number): string[] {
  return db
    .select({ id: assets.id })
    .from(assets)
    .where(and(isNotNull(assets.missingSince), lt(assets.missingSince, cutoff)))
    .all()
    .map((r) => r.id);
}
