import type { MediaItem, SyncBatch, SyncContext } from '@photobeaver/plugin-sdk';
import { folderOf, type OneDriveConfig } from './config';
import { GRAPH_URL, isHttpStatus, type GraphClient } from './graph';
import { toMediaItem } from './mapping';
import {
  loadFolders,
  parentPathOf,
  rootedFolders,
  saveFolders,
  trackFolder,
  type FolderMap,
} from './paths';
import type { DeltaPage, DriveItem } from './types';

type Ctx = SyncContext<OneDriveConfig>;

export const DELTA_SELECT = [
  'id',
  'name',
  'size',
  'webUrl',
  'cTag',
  'eTag',
  'lastModifiedDateTime',
  'file',
  'folder',
  'root',
  'deleted',
  'photo',
  'video',
  'image',
  'location',
  'parentReference',
].join(',');

interface PageChanges {
  upserts: MediaItem[];
  deletes: string[];
}

/**
 * Graph URL of the synced folder: the drive root, or a path below it.
 *
 * @param config - Source config.
 * @returns The drive item URL.
 */
export function rootItemUrl(config: OneDriveConfig): string {
  const folder = folderOf(config);
  if (!folder) return `${GRAPH_URL}/me/drive/root`;
  const encoded = folder.split('/').map(encodeURIComponent).join('/');
  return `${GRAPH_URL}/me/drive/root:/${encoded}:`;
}

/**
 * The delta URL that starts a full enumeration of the synced folder.
 *
 * @param config - Source config.
 * @returns The first delta URL.
 */
export function deltaStartUrl(config: OneDriveConfig): string {
  return `${rootItemUrl(config)}/delta?$select=${DELTA_SELECT}`;
}

function lastOccurrences(items: DriveItem[]): DriveItem[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

async function unchangedFiltered(ctx: Ctx, items: MediaItem[]): Promise<MediaItem[]> {
  if (items.length === 0) return items;
  const known = await ctx.isKnown(items.map((item) => item.externalId));
  return items.filter((item) => known[item.externalId]?.etag !== item.etag);
}

async function pageChanges(ctx: Ctx, page: DeltaPage, folders: FolderMap): Promise<PageChanges> {
  const items = lastOccurrences(page.value);
  items.forEach((item) => trackFolder(folders, item));
  const deletes = items.filter((item) => item.deleted && !item.folder).map((item) => item.id);
  const media = items
    .filter((item) => !item.deleted)
    .map((item) => toMediaItem(item, parentPathOf(folders, item)))
    .filter((item): item is MediaItem => item !== null);
  return { upserts: await unchangedFiltered(ctx, media), deletes };
}

async function startFolders(ctx: Ctx, client: GraphClient, fullScan: boolean) {
  if (!fullScan) return loadFolders(ctx);
  const root = await client.json<DriveItem>(`${rootItemUrl(ctx.config)}?$select=id`);
  return rootedFolders(root.id, folderOf(ctx.config));
}

function nextCursor(page: DeltaPage): string {
  const cursor = page['@odata.nextLink'] ?? page['@odata.deltaLink'];
  if (!cursor) throw new Error('OneDrive returned a delta page without a next or delta link');
  return cursor;
}

function toBatch(changes: PageChanges, page: DeltaPage, done: number, fullScan: boolean) {
  const finalPage = page['@odata.nextLink'] === undefined;
  const batch: SyncBatch = {
    ...changes,
    cursor: nextCursor(page),
    progress: { done, message: `${done} OneDrive items checked` },
  };
  return finalPage && fullScan ? { ...batch, isFullScan: true } : batch;
}

async function* walkDelta(ctx: Ctx, client: GraphClient, cursor: string | null) {
  const fullScan = cursor === null;
  const folders = await startFolders(ctx, client, fullScan);
  let url: string | undefined = cursor ?? deltaStartUrl(ctx.config);
  let done = 0;
  while (url) {
    ctx.signal.throwIfAborted();
    const page: DeltaPage = await client.json<DeltaPage>(url);
    const changes = await pageChanges(ctx, page, folders);
    await saveFolders(ctx, folders);
    done += page.value.length;
    const batch = toBatch(changes, page, done, fullScan);
    ctx.reportProgress(batch.progress!);
    yield batch;
    url = page['@odata.nextLink'];
  }
}

/**
 * Runs the Graph delta query from a stored cursor (a nextLink or deltaLink) or, for a null
 * cursor, as a full enumeration. One batch per delta page. An expired token (410 Gone)
 * restarts as a full scan.
 *
 * @param ctx - Sync context.
 * @param client - Authorized Graph client.
 * @param cursor - Stored cursor, or null.
 * @returns The batches.
 */
export async function* syncDelta(
  ctx: Ctx,
  client: GraphClient,
  cursor: string | null,
): AsyncGenerator<SyncBatch> {
  try {
    yield* walkDelta(ctx, client, cursor);
  } catch (error) {
    if (!isHttpStatus(error, 410)) throw error;
    ctx.log.warn('OneDrive asked for a resync, starting a full scan');
    yield* walkDelta(ctx, client, null);
  }
}
