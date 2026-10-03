import type { LibraryDb } from '@photobeaver/db';
import { sql } from 'drizzle-orm';

const CHUNK = 500;

function refreshChunk(db: LibraryDb, ids: readonly string[], now: number): void {
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  db.run(sql`
    UPDATE assets SET missing_since = CASE
      WHEN EXISTS (SELECT 1 FROM instances
                   WHERE instances.asset_id = assets.id AND instances.deleted_at IS NULL)
      THEN NULL ELSE COALESCE(missing_since, ${now}) END
    WHERE id IN (${list})`);
}

/**
 * Recomputes `missing_since` for assets: cleared when a live instance exists,
 * set to `now` (keeping an earlier value) when none does (SPEC 4.3 "Missing").
 *
 * @param db - Database or transaction.
 * @param assetIds - Assets to refresh.
 * @param now - Current time.
 */
export function refreshMissing(db: LibraryDb, assetIds: readonly string[], now: number): void {
  for (let i = 0; i < assetIds.length; i += CHUNK)
    refreshChunk(db, assetIds.slice(i, i + CHUNK), now);
}
