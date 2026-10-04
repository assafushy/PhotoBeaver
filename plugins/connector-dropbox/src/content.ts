import type { ItemRef, SourceContext } from '@photobeaver/plugin-sdk';
import { createClient, download, isConflict } from './api';
import { sourceTokens } from './auth';
import type { DropboxConfig } from './config';

type Ctx = SourceContext<DropboxConfig>;

function bodyOf(response: Response): ReadableStream<Uint8Array> {
  return response.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() });
}

/**
 * Picks the Dropbox thumbnail size for a requested edge length.
 *
 * @param size - Requested size in pixels.
 * @returns A Dropbox ThumbnailSize tag.
 */
export function thumbnailSize(size: number): string {
  return size <= 256 ? 'w256h256' : 'w1024h768';
}

/**
 * Fetches a JPEG thumbnail rendered by Dropbox.
 *
 * @param ctx - Source context.
 * @param item - The item (its externalId is the Dropbox file id).
 * @param size - Requested size in pixels.
 * @returns The JPEG bytes, or null when Dropbox cannot render one for this file.
 */
export async function getDropboxThumbnail(
  ctx: Ctx,
  item: ItemRef,
  size: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const client = createClient(ctx, await sourceTokens(ctx));
  const arg = {
    resource: { '.tag': 'path', path: item.externalId },
    format: 'jpeg',
    size: thumbnailSize(size),
    mode: 'fitone_bestfit',
  };
  try {
    return bodyOf(await download(client, '/files/get_thumbnail_v2', arg));
  } catch (error) {
    if (isConflict(error)) return null;
    throw error;
  }
}

/**
 * Streams the original file from Dropbox.
 *
 * @param ctx - Source context.
 * @param item - The item (its externalId is the Dropbox file id).
 * @returns The file bytes.
 */
export async function getDropboxOriginal(
  ctx: Ctx,
  item: ItemRef,
): Promise<ReadableStream<Uint8Array>> {
  const client = createClient(ctx, await sourceTokens(ctx));
  return bodyOf(await download(client, '/files/download', { path: item.externalId }));
}
