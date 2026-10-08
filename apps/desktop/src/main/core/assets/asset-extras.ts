import { albumScopeCondition } from '../albums/album-queries';
import { schema, type LibraryDb } from '@photobeaver/db';
import type { AssetDetail } from '@photobeaver/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { AccessScope } from '../access/scope';
import { SEARCH_TEXT_KEY } from '../enrich/search-text';

const { assetTags, tags, enrichments, assetMerges, albums, albumAssets } = schema;

/**
 * Albums that contain an asset; a scoped user sees the same albums as on the Albums screen.
 *
 * @param db - Library database.
 * @param assetId - Asset id.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns Albums by name; `user` marks albums made in the app (no source).
 */
export function albumsOf(
  db: LibraryDb,
  assetId: string,
  scope: AccessScope | null,
): AssetDetail['albums'] {
  return db
    .select({ id: albums.id, name: albums.name, sourceId: albums.sourceId })
    .from(albumAssets)
    .innerJoin(albums, eq(albums.id, albumAssets.albumId))
    .where(and(eq(albumAssets.assetId, assetId), albumScopeCondition(scope)))
    .orderBy(asc(albums.name))
    .all()
    .map((row) => ({ id: row.id, name: row.name, user: row.sourceId === null }));
}

/**
 * Tags of an asset, places first.
 *
 * @param db - Library database.
 * @param assetId - Asset id.
 * @returns Tag names and kinds.
 */
export function tagsOf(db: LibraryDb, assetId: string): AssetDetail['tags'] {
  const rows = db
    .select({ name: tags.name, kind: tags.kind })
    .from(assetTags)
    .innerJoin(tags, eq(tags.id, assetTags.tagId))
    .where(eq(assetTags.assetId, assetId))
    .all();
  return rows.sort(
    (a, b) =>
      Number(b.kind === 'place') - Number(a.kind === 'place') || a.name.localeCompare(b.name),
  );
}

/**
 * Enrichment data grouped by plugin (SPEC 8.1 #2), without internal keys.
 *
 * @param db - Library database.
 * @param assetId - Asset id.
 * @returns One entry per plugin.
 */
export function enrichmentsOf(db: LibraryDb, assetId: string): AssetDetail['enrichments'] {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of db.select().from(enrichments).where(eq(enrichments.assetId, assetId)).all()) {
    if (row.key === SEARCH_TEXT_KEY) continue;
    const data = grouped.get(row.pluginId) ?? {};
    data[row.key] = JSON.parse(row.valueJson) as unknown;
    grouped.set(row.pluginId, data);
  }
  return [...grouped.entries()].map(([pluginId, data]) => ({ pluginId, data }));
}

/**
 * The best place name: the most specific place tag order is city, region, country,
 * so the first place tag from the geocoder is used.
 *
 * @param detailTags - Asset tags.
 * @returns Place name or null.
 */
export function placeOf(detailTags: AssetDetail['tags']): string | null {
  const places = detailTags.filter((t) => t.kind === 'place').map((t) => t.name);
  return places.length ? places.join(', ') : null;
}

/**
 * Undoable merges that produced this asset (for "Undo merge" in the viewer).
 *
 * @param db - Library database.
 * @param assetId - Asset id.
 * @returns Merge ids, newest first.
 */
export function mergeIdsOf(db: LibraryDb, assetId: string): string[] {
  return db
    .select({ id: assetMerges.id })
    .from(assetMerges)
    .where(and(eq(assetMerges.survivingAssetId, assetId), isNull(assetMerges.undoneAt)))
    .orderBy(desc(assetMerges.createdAt))
    .all()
    .map((r) => r.id);
}

interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseFaceBox(bboxJson: string | null): FaceBox {
  return JSON.parse(bboxJson ?? '{"x":0,"y":0,"w":0,"h":0}') as FaceBox;
}

/**
 * Faces on an asset with the person each belongs to (viewer info panel).
 *
 * @param db - Database.
 * @param assetId - Asset id.
 * @returns Faces, left to right.
 */
export function facesOf(db: LibraryDb, assetId: string) {
  return db
    .select({
      id: schema.faces.id,
      bbox: schema.faces.bboxJson,
      personId: schema.faces.personId,
      personName: schema.people.name,
    })
    .from(schema.faces)
    .leftJoin(schema.people, eq(schema.people.id, schema.faces.personId))
    .where(eq(schema.faces.assetId, assetId))
    .all()
    .map((row) => ({ ...row, bbox: parseFaceBox(row.bbox) }))
    .sort((a, b) => a.bbox.x - b.bbox.x);
}
