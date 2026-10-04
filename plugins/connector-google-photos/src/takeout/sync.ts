import type { SyncBatch, SyncContext } from '@photobeaver/plugin-sdk';
import { openArchive, type ArchiveTree } from '@photobeaver/plugin-sdk/archive';
import type { GooglePhotosConfig } from '../config';
import { albumsOf, buildCatalog, type TakeoutItem } from './catalog';
import { etagOf, toMediaItem } from './items';
import { takeoutRoot } from './root';

export const BATCH_SIZE = 500;
export const DONE_CURSOR = 'done';
const AFTER = 'after:';

type Ctx = SyncContext<GooglePhotosConfig>;

/**
 * Reads the resume point from a cursor.
 *
 * @param cursor - Cursor of the last committed batch.
 * @returns The last externalId already sent, or null for a scan from the start.
 */
export function resumeAfter(cursor: string | null): string | null {
  return cursor?.startsWith(AFTER) ? cursor.slice(AFTER.length) : null;
}

async function changedItems(ctx: Ctx, tree: ArchiveTree, chunk: TakeoutItem[]) {
  const known = await ctx.isKnown(chunk.map((item) => item.externalId));
  const changed = chunk.filter((item) => known[item.externalId]?.etag !== etagOf(item.entry));
  const upserts = [];
  for (const item of changed) upserts.push(await toMediaItem(tree, item, ctx.log));
  return upserts;
}

async function toBatch(ctx: Ctx, tree: ArchiveTree, chunk: TakeoutItem[], done: number) {
  const last = chunk.at(-1)!.externalId;
  return {
    upserts: await changedItems(ctx, tree, chunk),
    albums: albumsOf(chunk),
    cursor: `${AFTER}${last}`,
    progress: { done, message: last },
  } satisfies SyncBatch;
}

async function* scan(ctx: Ctx, tree: ArchiveTree, after: string | null) {
  const pending = buildCatalog(tree.entries()).filter(
    (item) => after === null || item.externalId > after,
  );
  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    ctx.signal.throwIfAborted();
    const chunk = pending.slice(start, start + BATCH_SIZE);
    yield await toBatch(ctx, tree, chunk, start + chunk.length);
  }
  yield { upserts: [], cursor: DONE_CURSOR, isFullScan: true } satisfies SyncBatch;
}

/**
 * Full scan of a Google Takeout export, in batches of 500 sorted by externalId.
 * The last batch is marked as a full scan, so photos gone from the export are
 * removed. A missing folder throws before anything is sent, so nothing is removed.
 *
 * @param ctx - Sync context.
 * @param cursor - Cursor of the last committed batch.
 * @returns The batches.
 */
export async function* syncTakeout(ctx: Ctx, cursor: string | null): AsyncIterable<SyncBatch> {
  const tree = await openArchive(takeoutRoot(ctx.config));
  try {
    yield* scan(ctx, tree, resumeAfter(cursor));
  } finally {
    await tree.close();
  }
}
