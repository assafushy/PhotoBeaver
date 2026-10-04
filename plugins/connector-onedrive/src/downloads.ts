import type { ItemRef, SourceContext } from '@photobeaver/plugin-sdk';
import type { OneDriveConfig } from './config';
import { downloadPublic, graphClient, itemUrl, orNullOnNotFound, type GraphClient } from './graph';
import type { DownloadInfo, ThumbnailInfo } from './types';

type Ctx = SourceContext<OneDriveConfig>;

const MEDIUM_EDGE = 176;
const LARGE_EDGE = 800;

/**
 * Picks a Graph thumbnail size for a requested longest edge: the standard `medium` (176 px)
 * or `large` (800 px), or a custom bounding box `c{size}x{size}` above that.
 *
 * @param size - Requested longest edge in pixels.
 * @returns The Graph thumbnail size name.
 */
export function thumbnailSizeName(size: number): string {
  if (size <= MEDIUM_EDGE) return 'medium';
  if (size <= LARGE_EDGE) return 'large';
  const edge = Math.round(size);
  return `c${edge}x${edge}`;
}

function thumbnailInfo(client: GraphClient, item: ItemRef, name: string) {
  const url = `${itemUrl(item.externalId)}/thumbnails/0/${name}`;
  return orNullOnNotFound(client.json<ThumbnailInfo>(url));
}

async function thumbnailUrl(client: GraphClient, item: ItemRef, size: number) {
  const name = thumbnailSizeName(size);
  const info = await thumbnailInfo(client, item, name);
  if (info?.url || name === 'large' || name === 'medium') return info?.url;
  return (await thumbnailInfo(client, item, 'large'))?.url;
}

/**
 * Streams a Graph-generated thumbnail. Graph returns a pre-authenticated URL that is
 * fetched without the access token.
 *
 * @param ctx - Source context.
 * @param item - The item.
 * @param size - Requested longest edge in pixels.
 * @returns The thumbnail bytes, or null when OneDrive has none.
 */
export async function getThumbnail(
  ctx: Ctx,
  item: ItemRef,
  size: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const url = await thumbnailUrl(await graphClient(ctx), item, size);
  return url ? downloadPublic(ctx, url) : null;
}

/**
 * Streams the original file from its `@microsoft.graph.downloadUrl`, a short-lived
 * pre-authenticated URL that is fetched without the access token.
 *
 * @param ctx - Source context.
 * @param item - The item.
 * @returns The file bytes.
 */
export async function getOriginal(ctx: Ctx, item: ItemRef): Promise<ReadableStream<Uint8Array>> {
  const client = await graphClient(ctx);
  const url = `${itemUrl(item.externalId)}?$select=id,@microsoft.graph.downloadUrl`;
  const info = await client.json<DownloadInfo>(url);
  const downloadUrl = info['@microsoft.graph.downloadUrl'];
  if (!downloadUrl) throw new Error(`OneDrive has no download link for ${item.externalId}`);
  return downloadPublic(ctx, downloadUrl);
}
