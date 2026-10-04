import type { MediaItem, SyncBatch, SyncContext } from '@photobeaver/plugin-sdk';
import {
  createClient,
  isConflict,
  listFolder,
  listFolderContinue,
  type DropboxClient,
} from './api';
import { sourceTokens } from './auth';
import { normalizeFolder, type DropboxConfig } from './config';
import { isMediaFile, toMediaItem } from './mapping';
import { PathIndex } from './path-index';
import type { DropboxEntry, ListFolderResult } from './types';

type Ctx = SyncContext<DropboxConfig>;

interface ScanState {
  client: DropboxClient;
  index: PathIndex;
  fullScan: boolean;
  done: number;
}

async function applyEntries(index: PathIndex, entries: DropboxEntry[]): Promise<string[]> {
  const deletes: string[] = [];
  for (const entry of entries) {
    if (entry['.tag'] === 'deleted') deletes.push(...(await index.remove(entry.path_lower)));
    else if (entry['.tag'] === 'folder') await index.addFolder(entry.path_lower);
    else if (isMediaFile(entry)) await index.addFile(entry.path_lower, entry.id);
  }
  await index.flush();
  return deletes;
}

async function changedOnly(ctx: Ctx, items: MediaItem[]): Promise<MediaItem[]> {
  if (items.length === 0) return items;
  const known = await ctx.isKnown(items.map((item) => item.externalId));
  return items.filter((item) => known[item.externalId]?.etag !== item.etag);
}

async function toBatch(ctx: Ctx, state: ScanState, page: ListFolderResult): Promise<SyncBatch> {
  const items = page.entries.filter(isMediaFile).map(toMediaItem);
  const live = new Set(items.map((item) => item.externalId));
  const deletes = (await applyEntries(state.index, page.entries)).filter((id) => !live.has(id));
  state.done += page.entries.length;
  const progress = { done: state.done, message: page.entries.at(-1)?.path_display };
  ctx.reportProgress(progress);
  const batch: SyncBatch = {
    upserts: state.fullScan ? await changedOnly(ctx, items) : items,
    cursor: page.cursor,
    progress,
  };
  if (deletes.length > 0) batch.deletes = deletes;
  if (state.fullScan && !page.has_more) batch.isFullScan = true;
  return batch;
}

async function* pages(ctx: Ctx, state: ScanState, cursor: string | null) {
  let page =
    cursor === null
      ? await listFolder(state.client, normalizeFolder(ctx.config.folder))
      : await listFolderContinue(state.client, cursor);
  for (;;) {
    ctx.signal.throwIfAborted();
    yield await toBatch(ctx, state, page);
    if (!page.has_more) return;
    ctx.signal.throwIfAborted();
    page = await listFolderContinue(state.client, page.cursor);
  }
}

async function* continueOrRescan(ctx: Ctx, state: ScanState, cursor: string) {
  try {
    yield* pages(ctx, state, cursor);
  } catch (error) {
    if (!isConflict(error, 'reset')) throw error;
    ctx.log.warn('Dropbox reset the listing cursor, starting a full scan');
    yield* pages(ctx, { ...state, fullScan: true, done: 0 }, null);
  }
}

/**
 * Lists the source's Dropbox folder. A null cursor runs a full recursive scan whose last
 * batch is marked `isFullScan`; a cursor lists changes since then, and a `reset` from
 * Dropbox falls back to a full scan. Each batch carries the Dropbox cursor.
 *
 * @param ctx - Sync context.
 * @param cursor - Cursor of the last committed batch, or null.
 * @returns One batch per Dropbox page.
 */
export async function* syncDropbox(ctx: Ctx, cursor: string | null): AsyncIterable<SyncBatch> {
  const client = createClient(ctx, await sourceTokens(ctx));
  const index = new PathIndex(ctx.storage, ctx.sourceId);
  const state: ScanState = { client, index, fullScan: cursor === null, done: 0 };
  if (cursor === null) yield* pages(ctx, state, null);
  else yield* continueOrRescan(ctx, state, cursor);
}
