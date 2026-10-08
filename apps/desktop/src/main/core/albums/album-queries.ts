import { schema, type LibraryDb } from '@photobeaver/db';
import type { AlbumSummary } from '@photobeaver/shared';
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { scopeCondition, type AccessScope } from '../access/scope';

const { albums, albumAssets, assets, sources } = schema;

export type AlbumRow = typeof albums.$inferSelect;

/**
 * Which albums a user can see: everything when unscoped, otherwise the albums
 * in their scope and the albums of the sources in their scope.
 *
 * @param scope - The user's scope.
 * @returns The condition, or undefined when the user is not scoped.
 */
export function albumScopeCondition(scope: AccessScope | null): SQL | undefined {
  if (!scope) return undefined;
  const byAlbum = scope.albumIds.length ? inArray(albums.id, scope.albumIds) : sql`0`;
  const bySource = scope.sourceIds.length ? inArray(albums.sourceId, scope.sourceIds) : sql`0`;
  return or(byAlbum, bySource);
}

/**
 * One album, if the user can see it.
 *
 * @param db - Database.
 * @param scope - The user's scope.
 * @param id - Album id.
 * @returns The album row, or undefined.
 */
export function visibleAlbum(
  db: LibraryDb,
  scope: AccessScope | null,
  id: string,
): AlbumRow | undefined {
  return db
    .select()
    .from(albums)
    .where(and(eq(albums.id, id), albumScopeCondition(scope)))
    .get();
}

function memberCondition(scope: AccessScope | null, albumId: string): SQL {
  return and(
    eq(albumAssets.albumId, albumId),
    eq(assets.hidden, 0),
    isNull(assets.missingSince),
    scopeCondition(scope),
  )!;
}

const memberJoin = eq(assets.id, albumAssets.assetId);

function memberCount(db: LibraryDb, where: SQL): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(albumAssets)
    .innerJoin(assets, memberJoin)
    .where(where)
    .get();
  return row?.n ?? 0;
}

function coverOf(db: LibraryDb, where: SQL): string | null {
  const cover = db
    .select({ id: assets.id })
    .from(albumAssets)
    .innerJoin(assets, memberJoin)
    .where(where)
    .orderBy(
      sql`${albumAssets.position} IS NULL`,
      asc(albumAssets.position),
      asc(assets.capturedAt),
    )
    .limit(1)
    .get();
  return cover?.id ?? null;
}

function albumStats(db: LibraryDb, scope: AccessScope | null, albumId: string) {
  const where = memberCondition(scope, albumId);
  return { count: memberCount(db, where), coverAssetId: coverOf(db, where) };
}

/**
 * The albums a user can see, user albums first, each with the number of assets
 * the user can see in it and a cover.
 *
 * @param db - Database.
 * @param scope - The user's scope.
 * @returns Album summaries.
 */
export function listAlbums(db: LibraryDb, scope: AccessScope | null): AlbumSummary[] {
  const rows = db
    .select({ album: albums, sourceName: sources.displayName })
    .from(albums)
    .leftJoin(sources, eq(sources.id, albums.sourceId))
    .where(albumScopeCondition(scope))
    .orderBy(sql`${albums.sourceId} IS NOT NULL`, asc(albums.name), asc(albums.id))
    .all();
  return rows.map(({ album, sourceName }) => albumSummary(db, scope, album, sourceName));
}

/**
 * Summary of one album as the user sees it.
 *
 * @param db - Database.
 * @param scope - The user's scope.
 * @param album - The album row.
 * @param sourceName - Name of the album's source, for source albums.
 * @returns The summary.
 */
export function albumSummary(
  db: LibraryDb,
  scope: AccessScope | null,
  album: AlbumRow,
  sourceName: string | null = null,
): AlbumSummary {
  return {
    id: album.id,
    name: album.name,
    sourceId: album.sourceId ?? null,
    sourceName,
    ...albumStats(db, scope, album.id),
  };
}

/**
 * The next position at the end of an album.
 *
 * @param db - Database or transaction.
 * @param albumId - Album id.
 * @returns One past the highest position.
 */
export function nextPosition(db: LibraryDb, albumId: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${albumAssets.position})` })
    .from(albumAssets)
    .where(eq(albumAssets.albumId, albumId))
    .get();
  return (row?.max ?? -1) + 1;
}
