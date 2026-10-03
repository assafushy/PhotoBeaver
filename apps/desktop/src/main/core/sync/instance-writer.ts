import { schema, type LibraryDb } from '@photobeaver/db';
import type { MediaItem } from '@photobeaver/plugin-sdk';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { ulid } from 'ulid';
import { captureDateFromItem, pickCapturedAt, type CapturedAt } from '../assets/capture-date';

const { assets, instances } = schema;

type InstanceRow = typeof instances.$inferSelect;
type AssetRow = typeof assets.$inferSelect;

export type UpsertOutcome = 'created' | 'changed' | 'unchanged' | 'revived';

export interface UpsertResult {
  assetId: string;
  outcome: UpsertOutcome;
}

export interface WriteContext {
  db: LibraryDb;
  sourceId: string;
  runId: string;
  now: number;
}

const toMs = (iso: string | undefined): number | null => (iso ? Date.parse(iso) : null);

function sourceMetadata(item: MediaItem): string {
  const { filename, caption, contentHash, albums, metadata, mime } = item;
  return JSON.stringify({ filename, caption, contentHash, albums, metadata, mime });
}

function instanceFields(item: MediaItem, ctx: WriteContext) {
  return {
    externalUrl: item.externalUrl ?? null,
    path: item.path ?? null,
    sizeBytes: item.sizeBytes ?? null,
    sourceModifiedAt: toMs(item.modifiedAt),
    sourceMetadataJson: sourceMetadata(item),
    etag: item.etag ?? null,
    seenRunId: ctx.runId,
    deletedAt: null,
  };
}

function isUnchanged(existing: InstanceRow, item: MediaItem): boolean {
  if (item.etag && existing.etag) return item.etag === existing.etag;
  return toMs(item.modifiedAt) !== null && toMs(item.modifiedAt) === existing.sourceModifiedAt;
}

function storedCapturedAt(asset: AssetRow): CapturedAt | null {
  if (asset.capturedAt === null || !asset.capturedAtSource) return null;
  return { value: asset.capturedAt, source: asset.capturedAtSource };
}

function assetFields(item: MediaItem, captured: CapturedAt | null, now: number) {
  return {
    mediaType: item.kind,
    mime: item.mime ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    durationMs: item.durationMs === undefined ? null : Math.round(item.durationMs),
    capturedAt: captured?.value ?? null,
    capturedAtSource: captured?.source ?? null,
    lat: item.location?.lat ?? null,
    lon: item.location?.lon ?? null,
    thumbState: 'pending' as const,
    missingSince: null,
    updatedAt: now,
  };
}

function createAsset(item: MediaItem, ctx: WriteContext): UpsertResult {
  const assetId = ulid(ctx.now);
  const captured = captureDateFromItem(item);
  ctx.db
    .insert(assets)
    .values({ id: assetId, createdAt: ctx.now, ...assetFields(item, captured, ctx.now) })
    .run();
  ctx.db
    .insert(instances)
    .values({
      id: ulid(ctx.now),
      assetId,
      sourceId: ctx.sourceId,
      externalId: item.externalId,
      ...instanceFields(item, ctx),
    })
    .run();
  return { assetId, outcome: 'created' };
}

function updateChangedAsset(asset: AssetRow, item: MediaItem, now: number, db: LibraryDb): void {
  const captured = pickCapturedAt(storedCapturedAt(asset), captureDateFromItem(item));
  const fields = assetFields(item, captured, now);
  db.update(assets)
    .set({
      ...fields,
      width: fields.width ?? asset.width,
      height: fields.height ?? asset.height,
      lat: fields.lat ?? asset.lat,
      lon: fields.lon ?? asset.lon,
    })
    .where(eq(assets.id, asset.id))
    .run();
}

function updateExisting(existing: InstanceRow, item: MediaItem, ctx: WriteContext): UpsertResult {
  const unchanged = isUnchanged(existing, item);
  const revived = existing.deletedAt !== null;
  const fields = unchanged ? { seenRunId: ctx.runId, deletedAt: null } : instanceFields(item, ctx);
  ctx.db.update(instances).set(fields).where(eq(instances.id, existing.id)).run();
  const asset = ctx.db.select().from(assets).where(eq(assets.id, existing.assetId)).get()!;
  if (!unchanged) updateChangedAsset(asset, item, ctx.now, ctx.db);
  const outcome: UpsertOutcome = unchanged ? (revived ? 'revived' : 'unchanged') : 'changed';
  return { assetId: existing.assetId, outcome };
}

/**
 * Upserts one connector item (SPEC 4.3 steps 1 and 2): a new instance gets a new
 * asset; a known instance keeps its asset and only marks it changed when its
 * etag (or modified time) differs.
 *
 * @param item - Validated media item.
 * @param ctx - Transaction, source, run id and time.
 * @returns The asset id and what happened.
 */
export function upsertItem(item: MediaItem, ctx: WriteContext): UpsertResult {
  const existing = ctx.db
    .select()
    .from(instances)
    .where(and(eq(instances.sourceId, ctx.sourceId), eq(instances.externalId, item.externalId)))
    .get();
  return existing ? updateExisting(existing, item, ctx) : createAsset(item, ctx);
}

/**
 * Tombstones instances by external id.
 *
 * @param externalIds - Ids reported as deleted.
 * @param ctx - Transaction, source and time.
 * @returns Asset ids whose instances were tombstoned.
 */
export function tombstoneItems(externalIds: readonly string[], ctx: WriteContext): string[] {
  if (externalIds.length === 0) return [];
  return ctx.db
    .update(instances)
    .set({ deletedAt: ctx.now })
    .where(
      and(
        eq(instances.sourceId, ctx.sourceId),
        inArray(instances.externalId, [...externalIds]),
        isNull(instances.deletedAt),
      ),
    )
    .returning({ assetId: instances.assetId })
    .all()
    .map((row) => row.assetId);
}

/**
 * Tombstones live instances of the source that were not seen in this run (full scan end).
 *
 * @param ctx - Transaction, source, run id and time.
 * @returns Asset ids whose instances were tombstoned.
 */
export function tombstoneUnseen(ctx: WriteContext): string[] {
  return ctx.db
    .update(instances)
    .set({ deletedAt: ctx.now })
    .where(
      and(
        eq(instances.sourceId, ctx.sourceId),
        isNull(instances.deletedAt),
        or(isNull(instances.seenRunId), ne(instances.seenRunId, ctx.runId)),
      ),
    )
    .returning({ assetId: instances.assetId })
    .all()
    .map((row) => row.assetId);
}
