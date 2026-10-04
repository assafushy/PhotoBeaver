import type { FaceStore } from '../faces/face-store';
import { schema, type LibraryDb } from '@photobeaver/db';
import type { EnrichmentResultPayload } from '@photobeaver/shared/rpc';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { pickCapturedAt, type CapturedAt } from '../assets/capture-date';
import { pickLocation, type Located } from '../assets/location';
import { refreshSearchText, SEARCH_TEXT_KEY } from './search-text';

const { assets, enrichments, tags, assetTags, assetIdentity } = schema;

type AssetRow = typeof assets.$inferSelect;
type Rank = 'exif' | 'enricher';

export interface ApplyContext {
  db: LibraryDb;
  assetId: string;
  pluginId: string;
  pluginVersion: string;
  rank: Rank;
  canMerge: boolean;
  now: number;
  faces: FaceStore;
}

function replaceData(ctx: ApplyContext, result: EnrichmentResultPayload): void {
  const { db, assetId, pluginId, pluginVersion, now } = ctx;
  db.delete(enrichments)
    .where(and(eq(enrichments.assetId, assetId), eq(enrichments.pluginId, pluginId)))
    .run();
  const entries = Object.entries(result.data ?? {});
  if (result.searchText) entries.push([SEARCH_TEXT_KEY, result.searchText]);
  for (const [key, value] of entries) {
    db.insert(enrichments)
      .values({
        assetId,
        pluginId,
        pluginVersion,
        key,
        valueJson: JSON.stringify(value),
        createdAt: now,
      })
      .run();
  }
}

function tagId(db: LibraryDb, name: string, kind: 'auto' | 'place'): string {
  const existing = db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.name, name), eq(tags.kind, kind)))
    .get();
  if (existing) return existing.id;
  const id = ulid();
  db.insert(tags).values({ id, name, kind }).run();
  return id;
}

function replaceTags(ctx: ApplyContext, result: EnrichmentResultPayload): void {
  const { db, assetId, pluginId } = ctx;
  db.delete(assetTags)
    .where(and(eq(assetTags.assetId, assetId), eq(assetTags.pluginId, pluginId)))
    .run();
  for (const tag of result.tags ?? []) {
    const values = {
      assetId,
      tagId: tagId(db, tag.name, tag.kind ?? 'auto'),
      pluginId,
      confidence: tag.confidence ?? null,
    };
    db.insert(assetTags).values(values).onConflictDoNothing().run();
  }
}

function storedCapture(asset: AssetRow): CapturedAt | null {
  return asset.capturedAt === null || !asset.capturedAtSource
    ? null
    : { value: asset.capturedAt, source: asset.capturedAtSource };
}

function storedLocation(asset: AssetRow): Located | null {
  return asset.lat === null || asset.lon === null || !asset.locationSource
    ? null
    : { lat: asset.lat, lon: asset.lon, source: asset.locationSource };
}

function coreFields(asset: AssetRow, result: EnrichmentResultPayload, rank: Rank) {
  const capture = result.capturedAt ? { value: Date.parse(result.capturedAt), source: rank } : null;
  const location = result.location ? { ...result.location, source: rank } : null;
  const captured = pickCapturedAt(storedCapture(asset), capture);
  const located = pickLocation(storedLocation(asset), location);
  const dims = result.dimensions;
  return {
    capturedAt: captured?.value ?? null,
    capturedAtSource: captured?.source ?? null,
    lat: located?.lat ?? null,
    lon: located?.lon ?? null,
    locationSource: located?.source ?? null,
    width: asset.width ?? dims?.width ?? null,
    height: asset.height ?? dims?.height ?? null,
    durationMs:
      asset.durationMs ?? (dims?.durationMs === undefined ? null : Math.round(dims.durationMs)),
  };
}

function applyCoreFields(ctx: ApplyContext, result: EnrichmentResultPayload): void {
  const asset = ctx.db.select().from(assets).where(eq(assets.id, ctx.assetId)).get();
  if (!asset) return;
  ctx.db
    .update(assets)
    .set({ ...coreFields(asset, result, ctx.rank), updatedAt: ctx.now })
    .where(eq(assets.id, ctx.assetId))
    .run();
}

function replaceFaces(ctx: ApplyContext, result: EnrichmentResultPayload): void {
  if (!result.faces) return;
  ctx.faces.sync(ctx.db, { assetId: ctx.assetId, pluginId: ctx.pluginId }, result.faces);
}

function replaceIdentity(ctx: ApplyContext, keys: readonly string[]): void {
  const { db, assetId, pluginId } = ctx;
  db.delete(assetIdentity)
    .where(and(eq(assetIdentity.assetId, assetId), eq(assetIdentity.pluginId, pluginId)))
    .run();
  for (const key of new Set(keys))
    db.insert(assetIdentity).values({ assetId, pluginId, key }).onConflictDoNothing().run();
}

/**
 * Stores an enrichment result (SPEC 6.3) in one transaction: data under the
 * plugin's namespace, tags, core fields by precedence (dimensions only fill
 * gaps; the thumbnail decode is authoritative), faces, identity keys and the
 * search text. Identity keys need `assets: "merge"`.
 *
 * @param ctx - Asset, plugin, rank, merge permission and time.
 * @param result - Validated result.
 * @throws Error when identity features are used without permission.
 */
export function applyEnrichmentResult(ctx: ApplyContext, result: EnrichmentResultPayload): void {
  const usesIdentity = Boolean(
    result.identityKeys?.length || result.mergeWith?.length || result.suggestDuplicates?.length,
  );
  if (usesIdentity && !ctx.canMerge)
    throw new Error('This plugin is not allowed to publish identity keys or merge assets');
  ctx.db.transaction((tx) => {
    const inner = { ...ctx, db: tx as unknown as LibraryDb };
    replaceData(inner, result);
    replaceTags(inner, result);
    applyCoreFields(inner, result);
    replaceFaces(inner, result);
    if (ctx.canMerge && result.identityKeys) replaceIdentity(inner, result.identityKeys);
    refreshSearchText(inner.db, ctx.assetId);
  });
}
