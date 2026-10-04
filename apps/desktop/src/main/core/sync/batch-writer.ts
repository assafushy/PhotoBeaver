import { schema, type LibraryDb } from '@photobeaver/db';
import type { KnownItemState } from '@photobeaver/plugin-sdk';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { refreshMissing } from '../assets/missing';
import type { JobQueue } from '../jobs/job-queue';
import { PRIORITY } from '../jobs/job-types';
import { linkAssetAlbums, upsertAlbums } from './album-writer';
import { tombstoneItems, tombstoneUnseen, upsertItem, type WriteContext } from './instance-writer';
import type { ValidatedBatch } from './media-item-schema';

const { instances, sources } = schema;
const KNOWN_CHUNK = 500;

export interface BatchResult {
  created: number;
  changed: number;
  tombstoned: number;
  touchedAssetIds: string[];
}

/**
 * Dedupe key for an asset's thumbnail job.
 *
 * @param assetId - Asset id.
 * @returns The key.
 */
export const thumbnailDedupeKey = (assetId: string): string => `thumb:${assetId}`;

/**
 * Writes connector batches to the library (SPEC 7.4). Each call is one transaction
 * that also stores the batch cursor, so a crash loses at most the batch in flight.
 */
export class BatchWriter {
  constructor(
    private readonly db: LibraryDb,
    private readonly queue: JobQueue,
  ) {}

  /**
   * Applies one validated batch and its cursor atomically. Watch batches pass
   * `saveCursor: false` so they never disturb a resumable full scan.
   *
   * @param batch - The validated batch.
   * @param ctx - Source id, run id and time (db is ignored; a transaction is opened).
   * @param options - Whether to store the batch cursor (default true).
   * @returns Counts and the assets that changed.
   */
  apply(
    batch: ValidatedBatch,
    ctx: Omit<WriteContext, 'db'>,
    options: { saveCursor?: boolean } = {},
  ): BatchResult {
    return this.db.transaction((tx) => {
      const write = { ...ctx, db: tx as unknown as LibraryDb };
      upsertAlbums(batch.albums ?? [], write);
      const result = this.applyItems(batch, write);
      if (options.saveCursor !== false) {
        tx.update(sources)
          .set({ syncCursor: batch.cursor })
          .where(eq(sources.id, ctx.sourceId))
          .run();
      }
      return result;
    });
  }

  /**
   * Ends a run: tombstones unseen instances after a full scan and clears the run id.
   *
   * @param fullScan - Whether the final batch was a full scan.
   * @param ctx - Source id, run id and time.
   * @returns Number of instances tombstoned.
   */
  finishRun(fullScan: boolean, ctx: Omit<WriteContext, 'db'>): number {
    return this.db.transaction((tx) => {
      const write = { ...ctx, db: tx as unknown as LibraryDb };
      const tombstoned = fullScan ? tombstoneUnseen(write) : [];
      refreshMissing(write.db, [...new Set(tombstoned)], ctx.now);
      tx.update(sources).set({ syncRunId: null }).where(eq(sources.id, ctx.sourceId)).run();
      return tombstoned.length;
    });
  }

  /**
   * Answers `ctx.isKnown` and marks the known instances as seen in this run, so a
   * connector that skips unchanged items does not get them tombstoned by a full scan.
   *
   * @param externalIds - Ids the connector asks about.
   * @param ctx - Source id, run id and time.
   * @returns Known live instances keyed by external id.
   */
  markKnown(
    externalIds: readonly string[],
    ctx: Omit<WriteContext, 'db'>,
  ): Record<string, KnownItemState> {
    const known: Record<string, KnownItemState> = {};
    for (let i = 0; i < externalIds.length; i += KNOWN_CHUNK) {
      for (const row of this.markChunk(externalIds.slice(i, i + KNOWN_CHUNK), ctx)) {
        known[row.externalId] = {
          etag: row.etag ?? undefined,
          modifiedAt:
            row.sourceModifiedAt === null
              ? undefined
              : new Date(row.sourceModifiedAt).toISOString(),
        };
      }
    }
    return known;
  }

  private markChunk(ids: string[], ctx: Omit<WriteContext, 'db'>) {
    return this.db
      .update(instances)
      .set({ seenRunId: ctx.runId })
      .where(
        and(
          eq(instances.sourceId, ctx.sourceId),
          inArray(instances.externalId, ids),
          isNull(instances.deletedAt),
        ),
      )
      .returning({
        externalId: instances.externalId,
        etag: instances.etag,
        sourceModifiedAt: instances.sourceModifiedAt,
      })
      .all();
  }

  private applyItems(batch: ValidatedBatch, ctx: WriteContext): BatchResult {
    const result: BatchResult = { created: 0, changed: 0, tombstoned: 0, touchedAssetIds: [] };
    for (const item of batch.upserts) {
      const { assetId, outcome } = upsertItem(item, ctx);
      if (item.albums?.length) linkAssetAlbums(assetId, item.albums, ctx);
      if (outcome === 'created' || outcome === 'changed')
        this.queueThumbnail(assetId, result, outcome);
      if (outcome !== 'unchanged') result.touchedAssetIds.push(assetId);
    }
    const tombstoned = tombstoneItems(batch.deletes ?? [], ctx);
    result.tombstoned = tombstoned.length;
    result.touchedAssetIds.push(...tombstoned);
    refreshMissing(ctx.db, [...new Set(result.touchedAssetIds)], ctx.now);
    return result;
  }

  private queueThumbnail(
    assetId: string,
    result: BatchResult,
    outcome: 'created' | 'changed',
  ): void {
    result[outcome]++;
    this.queue.enqueue({
      kind: 'thumbnail',
      assetId,
      priority: PRIORITY.thumbnail,
      dedupeKey: thumbnailDedupeKey(assetId),
    });
  }
}
