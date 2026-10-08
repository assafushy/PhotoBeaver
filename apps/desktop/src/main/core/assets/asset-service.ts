import { schema, type LibraryDb } from '@photobeaver/db';
import type { AssetDetail } from '@photobeaver/shared';
import { eq } from 'drizzle-orm';
import { assetVisible, sourceVisible, type AccessScope } from '../access/scope';
import { albumsOf, enrichmentsOf, facesOf, mergeIdsOf, placeOf, tagsOf } from './asset-extras';

const { assets, instances, sources } = schema;

function filenameOf(metadataJson: string | null): string | null {
  if (!metadataJson) return null;
  const filename = (JSON.parse(metadataJson) as { filename?: unknown }).filename;
  return typeof filename === 'string' ? filename : null;
}

const instanceColumns = {
  id: instances.id,
  sourceId: instances.sourceId,
  sourceName: sources.displayName,
  path: instances.path,
  sizeBytes: instances.sizeBytes,
  externalUrl: instances.externalUrl,
  metadataJson: instances.sourceMetadataJson,
  deletedAt: instances.deletedAt,
};

function selectInstances(db: LibraryDb, assetId: string) {
  return db
    .select(instanceColumns)
    .from(instances)
    .innerJoin(sources, eq(sources.id, instances.sourceId))
    .where(eq(instances.assetId, assetId))
    .all();
}

type InstanceRow = ReturnType<typeof selectInstances>[number];

function toInstance(row: InstanceRow): AssetDetail['instances'][number] {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    filename: filenameOf(row.metadataJson),
    path: row.path,
    sizeBytes: row.sizeBytes,
    canOpen: row.externalUrl !== null && row.deletedAt === null,
    missing: row.deletedAt !== null,
  };
}

function redacted(instance: AssetDetail['instances'][number]): AssetDetail['instances'][number] {
  return { ...instance, path: null, canOpen: false };
}

function instancesOf(
  db: LibraryDb,
  assetId: string,
  scope: AccessScope | null,
): AssetDetail['instances'] {
  const all = selectInstances(db, assetId).map(toInstance);
  const visible = all.filter((i) => sourceVisible(scope, i.sourceId));
  return visible.length ? visible : all.map(redacted);
}

/**
 * Loads an asset with its instances for the viewer's info panel. For a scoped
 * user (SPEC 3.3) an asset outside the scope is reported as not found, and only
 * instances in visible sources are listed; an asset seen only through an album
 * lists its instances without path or "open in source".
 *
 * @param db - Library database.
 * @param assetId - Asset id.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns The asset detail.
 * @throws Error when the asset does not exist or is out of scope.
 */
export function getAssetDetail(
  db: LibraryDb,
  assetId: string,
  scope: AccessScope | null,
): AssetDetail {
  const row = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!row || !assetVisible(db, scope, assetId)) throw new Error(`Asset not found: ${assetId}`);
  return {
    id: row.id,
    mediaType: row.mediaType,
    mime: row.mime,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    capturedAt: row.capturedAt,
    capturedAtSource: row.capturedAtSource,
    locationSource: row.locationSource ?? null,
    lat: row.lat,
    lon: row.lon,
    favorite: row.favorite === 1,
    hidden: row.hidden === 1,
    thumbState: row.thumbState,
    instances: instancesOf(db, assetId, scope),
    ...extrasOf(db, assetId, scope),
  };
}

function extrasOf(
  db: LibraryDb,
  assetId: string,
  scope: AccessScope | null,
): Pick<AssetDetail, 'place' | 'tags' | 'enrichments' | 'mergeIds' | 'faces' | 'albums'> {
  const detailTags = tagsOf(db, assetId);
  return {
    albums: albumsOf(db, assetId, scope),
    tags: detailTags,
    place: placeOf(detailTags),
    enrichments: enrichmentsOf(db, assetId),
    mergeIds: mergeIdsOf(db, assetId),
    faces: facesOf(db, assetId),
  };
}

/**
 * The "open in source" link of a live instance. A scoped user only gets it when
 * both the instance's source and its asset are visible to them.
 *
 * @param db - Library database.
 * @param instanceId - Instance id.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns The external URL, or null.
 */
export function instanceExternalUrl(
  db: LibraryDb,
  instanceId: string,
  scope: AccessScope | null,
): string | null {
  const row = db
    .select({
      url: instances.externalUrl,
      deletedAt: instances.deletedAt,
      sourceId: instances.sourceId,
      assetId: instances.assetId,
    })
    .from(instances)
    .where(eq(instances.id, instanceId))
    .get();
  if (!row || row.deletedAt !== null) return null;
  const allowed = sourceVisible(scope, row.sourceId) && assetVisible(db, scope, row.assetId);
  return allowed ? row.url : null;
}
