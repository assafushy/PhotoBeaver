import { schema } from '@photobeaver/db';
import type { LibraryFilter } from '@photobeaver/shared';
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { scopeCondition, type AccessScope } from '../core/access/scope';

const { assets } = schema;

const visible = and(eq(assets.hidden, 0), isNull(assets.missingSince))!;

/**
 * Turns search text into an FTS5 query: every word must match as a prefix.
 * Quotes in the input are dropped so users cannot inject FTS syntax.
 *
 * @param text - What the user typed.
 * @returns The MATCH expression, or null when there are no words.
 */
export function ftsQuery(text: string): string | null {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 10);
  return words.length ? words.map((w) => `"${w}"*`).join(' AND ') : null;
}

const idList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

function liveInstanceIn(sourceIds: readonly string[]): SQL {
  return sql`EXISTS (SELECT 1 FROM instances i WHERE i.asset_id = ${assets.id} AND i.deleted_at IS NULL AND i.source_id IN (${idList(sourceIds)}))`;
}

function inAnyAlbum(albumIds: readonly string[]): SQL {
  return sql`EXISTS (SELECT 1 FROM album_assets aa WHERE aa.asset_id = ${assets.id} AND aa.album_id IN (${idList(albumIds)}))`;
}

function hasTag(tagId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = ${assets.id} AND t.tag_id = ${tagId})`;
}

function showsPerson(personId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM faces f WHERE f.asset_id = ${assets.id} AND f.person_id = ${personId})`;
}

function textMatch(text: string | undefined): SQL | undefined {
  const query = text ? ftsQuery(text) : null;
  if (text && !query) return sql`0`;
  return query
    ? sql`${assets.id} IN (SELECT asset_id FROM assets_fts WHERE assets_fts MATCH ${query})`
    : undefined;
}

const multiSource = sql`(SELECT COUNT(DISTINCT i.source_id) FROM instances i WHERE i.asset_id = ${assets.id} AND i.deleted_at IS NULL) > 1`;

/**
 * SQL conditions for the library filters (SPEC 8.1 #3). The unfiltered case is
 * just the visibility test, so it keeps using the library order index. The
 * user's scope (SPEC 3.3) is always applied on top.
 *
 * @param filter - User filters.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns The WHERE condition.
 */
export function filterCondition(filter: LibraryFilter, scope: AccessScope | null): SQL {
  const parts: (SQL | undefined)[] = [
    visible,
    scopeCondition(scope),
    textMatch(filter.text),
    filter.from === undefined ? undefined : gte(assets.capturedAt, filter.from),
    filter.to === undefined ? undefined : lte(assets.capturedAt, filter.to),
    filter.sourceIds?.length ? liveInstanceIn(filter.sourceIds) : undefined,
    filter.albumIds?.length ? inAnyAlbum(filter.albumIds) : undefined,
    filter.mediaTypes?.length ? inArray(assets.mediaType, filter.mediaTypes) : undefined,
    ...(filter.tagIds ?? []).map(hasTag),
    ...(filter.personIds ?? []).map(showsPerson),
    filter.favoritesOnly ? eq(assets.favorite, 1) : undefined,
    filter.multiSource ? multiSource : undefined,
  ];
  return and(...parts.filter((p): p is SQL => p !== undefined))!;
}
