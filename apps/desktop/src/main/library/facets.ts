import { schema, type LibraryDb } from '@photobeaver/db';
import type { GeoPoints, LibraryFacets, LibraryFilter } from '@photobeaver/shared';
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { scopeCondition, type AccessScope } from '../core/access/scope';
import { filterCondition } from './library-filter';

const { assets, instances, sources, tags, assetTags, people, faces } = schema;
export const GEO_POINT_LIMIT = 200_000;
const TAG_FACET_LIMIT = 50;

function visibleSources(scope: AccessScope | null) {
  if (!scope) return undefined;
  return scope.sourceIds.length ? inArray(sources.id, scope.sourceIds) : sql`0`;
}

function sourceFacets(db: LibraryDb, scope: AccessScope | null): LibraryFacets['sources'] {
  const liveVisible = and(
    eq(instances.sourceId, sources.id),
    isNull(instances.deletedAt),
    scopeCondition(scope, sql`${instances.assetId}`),
  );
  return db
    .select({ id: sources.id, name: sources.displayName, count: count(instances.id) })
    .from(sources)
    .leftJoin(instances, liveVisible)
    .where(visibleSources(scope))
    .groupBy(sources.id)
    .orderBy(sources.displayName)
    .all();
}

function tagFacets(
  db: LibraryDb,
  kinds: ('place' | 'auto' | 'user')[],
  scope: AccessScope | null,
): LibraryFacets['tags'] {
  return db
    .select({ id: tags.id, name: tags.name, count: count(assetTags.assetId) })
    .from(tags)
    .innerJoin(assetTags, eq(assetTags.tagId, tags.id))
    .innerJoin(
      assets,
      and(
        eq(assets.id, assetTags.assetId),
        eq(assets.hidden, 0),
        isNull(assets.missingSince),
        scopeCondition(scope),
      ),
    )
    .where(inArray(tags.kind, kinds))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${assetTags.assetId})`), tags.name)
    .limit(TAG_FACET_LIMIT)
    .all();
}

function peopleFacets(db: LibraryDb, scope: AccessScope | null): LibraryFacets['people'] {
  return db
    .select({
      id: people.id,
      name: people.name,
      count: sql<number>`count(DISTINCT ${faces.assetId})`,
    })
    .from(people)
    .innerJoin(faces, eq(faces.personId, people.id))
    .where(and(isNotNull(people.name), scopeCondition(scope, sql`${faces.assetId}`)))
    .groupBy(people.id)
    .orderBy(people.name)
    .all()
    .map((row) => ({ ...row, name: row.name ?? '' }));
}

/**
 * Filter choices with counts for the search chips (SPEC 8.1 #3): sources,
 * places, tags and named people. Only what the user's scope can see is listed
 * and counted.
 *
 * @param db - Library database.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns Facets.
 */
export function libraryFacets(db: LibraryDb, scope: AccessScope | null): LibraryFacets {
  return {
    sources: sourceFacets(db, scope),
    places: tagFacets(db, ['place'], scope),
    tags: tagFacets(db, ['auto', 'user'], scope),
    people: peopleFacets(db, scope),
  };
}

/**
 * Coordinates of visible geotagged assets for the Map screen (SPEC 8.1 #4).
 *
 * @param db - Library database.
 * @param filter - Same filters as the grid.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns `[id, lat, lon]` tuples, capped at 200,000.
 */
export function geoPoints(
  db: LibraryDb,
  filter: LibraryFilter,
  scope: AccessScope | null,
): GeoPoints {
  const rows = db
    .select({ id: assets.id, lat: assets.lat, lon: assets.lon })
    .from(assets)
    .where(and(filterCondition(filter, scope), isNotNull(assets.lat), isNotNull(assets.lon)))
    .limit(GEO_POINT_LIMIT + 1)
    .all();
  const points = rows
    .slice(0, GEO_POINT_LIMIT)
    .map((r) => [r.id, r.lat!, r.lon!] as [string, number, number]);
  return { points, truncated: rows.length > GEO_POINT_LIMIT };
}
