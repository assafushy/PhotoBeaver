import { schema, type LibraryDb } from '@photobeaver/db';
import type { GeoPoints, LibraryFacets, LibraryFilter } from '@photobeaver/shared';
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { filterCondition } from './library-filter';

const { assets, instances, sources, tags, assetTags } = schema;
export const GEO_POINT_LIMIT = 200_000;
const TAG_FACET_LIMIT = 50;

function sourceFacets(db: LibraryDb): LibraryFacets['sources'] {
  return db
    .select({ id: sources.id, name: sources.displayName, count: count(instances.id) })
    .from(sources)
    .leftJoin(instances, and(eq(instances.sourceId, sources.id), isNull(instances.deletedAt)))
    .groupBy(sources.id)
    .orderBy(sources.displayName)
    .all();
}

function tagFacets(db: LibraryDb, kinds: ('place' | 'auto' | 'user')[]): LibraryFacets['tags'] {
  return db
    .select({ id: tags.id, name: tags.name, count: count(assetTags.assetId) })
    .from(tags)
    .innerJoin(assetTags, eq(assetTags.tagId, tags.id))
    .innerJoin(
      assets,
      and(eq(assets.id, assetTags.assetId), eq(assets.hidden, 0), isNull(assets.missingSince)),
    )
    .where(inArray(tags.kind, kinds))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${assetTags.assetId})`), tags.name)
    .limit(TAG_FACET_LIMIT)
    .all();
}

/**
 * Filter choices with counts for the search chips (SPEC 8.1 #3): sources,
 * places and tags.
 *
 * @param db - Library database.
 * @returns Facets.
 */
export function libraryFacets(db: LibraryDb): LibraryFacets {
  return {
    sources: sourceFacets(db),
    places: tagFacets(db, ['place']),
    tags: tagFacets(db, ['auto', 'user']),
  };
}

/**
 * Coordinates of visible geotagged assets for the Map screen (SPEC 8.1 #4).
 *
 * @param db - Library database.
 * @param filter - Same filters as the grid.
 * @returns `[id, lat, lon]` tuples, capped at 200,000.
 */
export function geoPoints(db: LibraryDb, filter: LibraryFilter): GeoPoints {
  const rows = db
    .select({ id: assets.id, lat: assets.lat, lon: assets.lon })
    .from(assets)
    .where(and(filterCondition(filter), isNotNull(assets.lat), isNotNull(assets.lon)))
    .limit(GEO_POINT_LIMIT + 1)
    .all();
  const points = rows
    .slice(0, GEO_POINT_LIMIT)
    .map((r) => [r.id, r.lat!, r.lon!] as [string, number, number]);
  return { points, truncated: rows.length > GEO_POINT_LIMIT };
}
