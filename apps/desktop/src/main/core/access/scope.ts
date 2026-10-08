import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, sql, type SQL } from 'drizzle-orm';

const { assets, userScopes } = schema;

/**
 * What a scoped user may see (SPEC 3.3): sources and albums. `null` means the
 * whole library (unscoped users and every Admin).
 */
export interface AccessScope {
  sourceIds: string[];
  albumIds: string[];
}

const list = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

function inVisibleSource(sourceIds: readonly string[], assetId: SQL | typeof assets.id): SQL {
  if (sourceIds.length === 0) return sql`0`;
  return sql`EXISTS (SELECT 1 FROM instances si WHERE si.asset_id = ${assetId} AND si.deleted_at IS NULL AND si.source_id IN (${list(sourceIds)}))`;
}

function inVisibleAlbum(albumIds: readonly string[], assetId: SQL | typeof assets.id): SQL {
  if (albumIds.length === 0) return sql`0`;
  return sql`EXISTS (SELECT 1 FROM album_assets sa WHERE sa.asset_id = ${assetId} AND sa.album_id IN (${list(albumIds)}))`;
}

/**
 * SQL that keeps only assets the user may see: an asset is visible when one of
 * its live instances is in a visible source, or it is in a visible album.
 *
 * @param scope - The user's scope, or null for everything.
 * @param assetId - Column or expression holding the asset id (default `assets.id`).
 * @returns The condition, or undefined when the user is not scoped.
 */
export function scopeCondition(
  scope: AccessScope | null,
  assetId: SQL | typeof assets.id = assets.id,
): SQL | undefined {
  if (!scope) return undefined;
  return sql`(${inVisibleSource(scope.sourceIds, assetId)} OR ${inVisibleAlbum(scope.albumIds, assetId)})`;
}

/**
 * Whether one asset is visible to the user.
 *
 * @param db - Database.
 * @param scope - The user's scope.
 * @param assetId - Asset id.
 * @returns True when visible (or the user is not scoped).
 */
export function assetVisible(db: LibraryDb, scope: AccessScope | null, assetId: string): boolean {
  if (!scope) return true;
  const row = db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, assetId), scopeCondition(scope)))
    .get();
  return row !== undefined;
}

/**
 * Whether a source is visible to the user.
 *
 * @param scope - The user's scope.
 * @param sourceId - Source id.
 * @returns True when visible (or the user is not scoped).
 */
export const sourceVisible = (scope: AccessScope | null, sourceId: string): boolean =>
  !scope || scope.sourceIds.includes(sourceId);

/**
 * Reads a user's scope. Admins and users without scope rows see everything.
 *
 * @param db - Database.
 * @param user - User id and role.
 * @returns The scope, or null for the whole library.
 */
export function readScope(db: LibraryDb, user: { id: string; role: string }): AccessScope | null {
  if (user.role === 'admin') return null;
  const rows = db.select().from(userScopes).where(eq(userScopes.userId, user.id)).all();
  if (rows.length === 0) return null;
  const of = (type: 'source' | 'album') =>
    rows.filter((r) => r.scopeType === type).map((r) => r.scopeId);
  return { sourceIds: of('source'), albumIds: of('album') };
}
