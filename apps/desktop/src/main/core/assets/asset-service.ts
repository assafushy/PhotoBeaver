import { schema, type LibraryDb } from '@photobeaver/db';
import type { AssetDetail } from '@photobeaver/shared';
import { eq } from 'drizzle-orm';
import { enrichmentsOf, mergeIdsOf, placeOf, tagsOf } from './asset-extras';

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

function instancesOf(db: LibraryDb, assetId: string): AssetDetail['instances'] {
  return selectInstances(db, assetId).map(toInstance);
}

/**
 * Loads an asset with its instances for the viewer's info panel.
 *
 * @param db - Library database.
 * @param assetId - Asset id.
 * @returns The asset detail.
 * @throws Error when the asset does not exist.
 */
export function getAssetDetail(db: LibraryDb, assetId: string): AssetDetail {
  const row = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!row) throw new Error(`Asset not found: ${assetId}`);
  return {
    id: row.id,
    mediaType: row.mediaType,
    mime: row.mime,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    capturedAt: row.capturedAt,
    capturedAtSource: row.capturedAtSource,
    lat: row.lat,
    lon: row.lon,
    favorite: row.favorite === 1,
    thumbState: row.thumbState,
    instances: instancesOf(db, assetId),
    ...extrasOf(db, assetId),
  };
}

function extrasOf(
  db: LibraryDb,
  assetId: string,
): Pick<AssetDetail, 'place' | 'tags' | 'enrichments' | 'mergeIds'> {
  const detailTags = tagsOf(db, assetId);
  return {
    tags: detailTags,
    place: placeOf(detailTags),
    enrichments: enrichmentsOf(db, assetId),
    mergeIds: mergeIdsOf(db, assetId),
  };
}

/**
 * The "open in source" link of a live instance.
 *
 * @param db - Library database.
 * @param instanceId - Instance id.
 * @returns The external URL, or null.
 */
export function instanceExternalUrl(db: LibraryDb, instanceId: string): string | null {
  const row = db
    .select({ url: instances.externalUrl, deletedAt: instances.deletedAt })
    .from(instances)
    .where(eq(instances.id, instanceId))
    .get();
  return row && row.deletedAt === null ? row.url : null;
}
