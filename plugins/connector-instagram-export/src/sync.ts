import type { MediaItem, SyncBatch, SyncContext, SyncProgress } from '@photobeaver/plugin-sdk';
import type { InstagramExportConfig } from './config';
import { encodeCursor, resumePoint } from './cursor';
import { scanExport } from './scan';
import { requireRoot, withTree } from './tree';

export const BATCH_SIZE = 500;

type Ctx = SyncContext<InstagramExportConfig>;

function chunksOf(items: MediaItem[]): MediaItem[][] {
  const chunks: MediaItem[][] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    chunks.push(items.slice(start, start + BATCH_SIZE));
  }
  return chunks;
}

async function changedOnly(ctx: Ctx, items: MediaItem[]): Promise<MediaItem[]> {
  const known = await ctx.isKnown(items.map((item) => item.externalId));
  return items.filter((item) => known[item.externalId]?.etag !== item.etag);
}

async function toBatch(
  ctx: Ctx,
  chunk: MediaItem[],
  isLast: boolean,
  progress: SyncProgress,
): Promise<SyncBatch> {
  const upserts = await changedOnly(ctx, chunk);
  const lastId = chunk.at(-1)?.externalId ?? '';
  const batch: SyncBatch = {
    upserts,
    cursor: encodeCursor(isLast ? { done: true } : { after: lastId }),
    progress: { ...progress, message: lastId },
  };
  return isLast ? { ...batch, isFullScan: true } : batch;
}

/**
 * Runs a full scan of the export in sorted batches. A missing root throws before any
 * batch is yielded, so nothing is tombstoned while the export is unavailable.
 *
 * @param ctx - Sync context.
 * @param cursor - Cursor of the last committed batch, or null.
 * @returns Batches of new or changed items; the last one is marked as a full scan.
 */
export async function* syncExport(ctx: Ctx, cursor: string | null): AsyncGenerator<SyncBatch> {
  const all = await withTree(requireRoot(ctx.config), (tree) => scanExport(tree, ctx.log));
  const after = resumePoint(cursor);
  const pending = after === null ? all : all.filter((item) => item.externalId > after);
  const chunks = pending.length === 0 ? [[]] : chunksOf(pending);
  let done = all.length - pending.length;
  for (const [index, chunk] of chunks.entries()) {
    ctx.signal.throwIfAborted();
    done += chunk.length;
    const isLast = index === chunks.length - 1;
    yield await toBatch(ctx, chunk, isLast, { done, total: all.length });
  }
}
