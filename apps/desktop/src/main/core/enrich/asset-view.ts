import { schema, type LibraryDb } from '@photobeaver/db';
import type { AssetInstanceView, AssetView } from '@photobeaver/plugin-sdk';
import { and, eq, inArray, isNull } from 'drizzle-orm';

const { assets, instances, enrichments } = schema;

type InstanceRow = Pick<
  typeof instances.$inferSelect,
  'sourceId' | 'path' | 'sizeBytes' | 'sourceMetadataJson'
>;

interface StoredMetadata {
  filename?: string;
  caption?: string;
  contentHash?: { algo: string; value: string };
}

const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as T;

function instanceView(row: InstanceRow): AssetInstanceView {
  const meta = (row.sourceMetadataJson ? JSON.parse(row.sourceMetadataJson) : {}) as StoredMetadata;
  return defined({
    sourceId: row.sourceId,
    path: row.path ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    filename: meta.filename,
    caption: meta.caption,
    contentHash: meta.contentHash,
  });
}

function liveInstances(db: LibraryDb, assetId: string): AssetInstanceView[] {
  return db
    .select({
      sourceId: instances.sourceId,
      path: instances.path,
      sizeBytes: instances.sizeBytes,
      sourceMetadataJson: instances.sourceMetadataJson,
    })
    .from(instances)
    .where(and(eq(instances.assetId, assetId), isNull(instances.deletedAt)))
    .all()
    .map(instanceView);
}

function enrichmentsOf(
  db: LibraryDb,
  assetId: string,
  pluginIds: readonly string[],
): AssetView['enrichments'] {
  const out: AssetView['enrichments'] = {};
  if (pluginIds.length === 0) return out;
  const rows = db
    .select()
    .from(enrichments)
    .where(and(eq(enrichments.assetId, assetId), inArray(enrichments.pluginId, [...pluginIds])))
    .all();
  for (const row of rows)
    (out[row.pluginId] ??= {})[row.key] = JSON.parse(row.valueJson) as unknown;
  return out;
}

/**
 * What an enricher sees of an asset (SPEC 6.3): core fields, live instances and
 * the enrichments of the plugins it depends on. Times are floating local time
 * encoded as ISO strings in UTC (D41).
 *
 * @param db - Library database.
 * @param assetId - Asset id.
 * @param dependsOn - Plugins whose enrichments to include.
 * @returns The view, or null when the asset no longer exists.
 */
export function buildAssetView(
  db: LibraryDb,
  assetId: string,
  dependsOn: readonly string[],
): AssetView | null {
  const row = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!row) return null;
  return defined({
    id: row.id,
    kind: row.mediaType,
    mime: row.mime ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationMs: row.durationMs ?? undefined,
    capturedAt: row.capturedAt === null ? undefined : new Date(row.capturedAt).toISOString(),
    location: row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : undefined,
    instances: liveInstances(db, assetId),
    enrichments: enrichmentsOf(db, assetId, dependsOn),
  });
}
