import type { MediaItem, SyncBatch, SyncContext } from '@photobeaver/plugin-sdk';
import { HttpError } from '@photobeaver/plugin-sdk/http';
import type { GooglePhotosConfig } from '../config';
import {
  createClient,
  createSession,
  deleteSession,
  downloadBytes,
  listMediaItems,
  type PickerClient,
} from './api';
import { sourceTokens } from './auth';
import { decodePageCursor, DONE_CURSOR, encodePageCursor, type PageCursor } from './cursor';
import { previewUrl, toMediaItem } from './mapping';
import { savePreview } from './previews';
import type { MediaItemsPage, PickedMediaItem, PickingSession } from './types';
import { waitForPick } from './wait';

export const PICK_PROMPT = 'Choose photos in your browser, then click Done';
const CLEANUP_TIMEOUT_MS = 10_000;

type Ctx = SyncContext<GooglePhotosConfig>;

const emptyDone = (): SyncBatch => ({ upserts: [], cursor: DONE_CURSOR });

async function withPreview(ctx: Ctx, client: PickerClient, item: PickedMediaItem) {
  try {
    await savePreview(ctx, item.id, await downloadBytes(client, previewUrl(item)));
    return toMediaItem(item, true);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    ctx.log.warn('Could not download a preview', { itemId: item.id, status: error.status });
    return toMediaItem(item, false);
  }
}

async function pageItems(ctx: Ctx, client: PickerClient, page: MediaItemsPage) {
  const items: MediaItem[] = [];
  for (const item of page.mediaItems ?? []) {
    ctx.signal.throwIfAborted();
    items.push(await withPreview(ctx, client, item));
  }
  return items;
}

async function* readPages(
  ctx: Ctx,
  client: PickerClient,
  start: PageCursor,
  first: MediaItemsPage,
) {
  let page = first;
  let done = 0;
  for (;;) {
    const upserts = await pageItems(ctx, client, page);
    done += upserts.length;
    const next = page.nextPageToken ?? '';
    const cursor = next ? encodePageCursor({ ...start, pageToken: next }) : DONE_CURSOR;
    yield { upserts, cursor, progress: { done } } satisfies SyncBatch;
    if (!next) return;
    page = await listMediaItems(client, start.sessionId, next);
  }
}

async function removeSession(ctx: Ctx, client: PickerClient, sessionId: string): Promise<void> {
  const cleanup = { ...client, signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS) };
  await deleteSession(cleanup, sessionId).catch((error: unknown) => {
    ctx.log.warn('Could not delete the Picker session', { sessionId, error: String(error) });
  });
}

async function* pickAndRead(ctx: Ctx, client: PickerClient, session: PickingSession) {
  await ctx.ui.openExternal(session.pickerUri);
  ctx.ui.notify(PICK_PROMPT);
  ctx.reportProgress({ done: 0, message: PICK_PROMPT });
  if (!(await waitForPick(client, session))) {
    ctx.log.info('No photos were picked before the Picker session timed out');
    yield emptyDone();
    return;
  }
  const start = { sessionId: session.id, pageToken: '' };
  yield* readPages(ctx, client, start, await listMediaItems(client, session.id, ''));
}

async function* newPick(ctx: Ctx, client: PickerClient) {
  const session = await createSession(client);
  try {
    yield* pickAndRead(ctx, client, session);
  } finally {
    await removeSession(ctx, client, session.id);
  }
}

async function firstPageOrNull(client: PickerClient, position: PageCursor) {
  try {
    return await listMediaItems(client, position.sessionId, position.pageToken);
  } catch (error) {
    if (error instanceof HttpError && [400, 404].includes(error.status)) return null;
    throw error;
  }
}

async function* resumePick(ctx: Ctx, client: PickerClient, position: PageCursor) {
  const first = await firstPageOrNull(client, position);
  if (!first) {
    yield emptyDone();
    return;
  }
  try {
    yield* readPages(ctx, client, position, first);
  } finally {
    await removeSession(ctx, client, position.sessionId);
  }
}

/**
 * One Picker sync: opens a new Picker session in the browser, waits for the user's
 * selection, and stores metadata and a 1024 px preview of each picked item. A cursor
 * from an interrupted sync resumes reading that session instead. Never deletes.
 *
 * @param ctx - Sync context.
 * @param cursor - Cursor of the last committed batch.
 * @returns Batches of at most 100 items.
 */
export async function* syncPicker(ctx: Ctx, cursor: string | null): AsyncIterable<SyncBatch> {
  const client = createClient(ctx, await sourceTokens(ctx));
  const position = decodePageCursor(cursor);
  yield* position ? resumePick(ctx, client, position) : newPick(ctx, client);
}
