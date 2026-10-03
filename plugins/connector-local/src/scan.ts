import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MediaItem, SyncContext } from '@photobeaver/plugin-sdk';
import { mediaTypeOf } from './media-types';
import type { LocalConfig } from './config';

export interface ScannedFile {
  relative: string;
  item: MediaItem;
}

/**
 * Builds a MediaItem for one file, or null if it is not media or vanished.
 *
 * @param config - Source config.
 * @param relative - Root-relative path.
 * @returns The scanned file, or null.
 */
export async function scanFile(config: LocalConfig, relative: string): Promise<ScannedFile | null> {
  const type = mediaTypeOf(relative, config.includeVideos !== false);
  if (!type) return null;
  const absolute = path.join(config.root, ...relative.split('/'));
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) return null;
  const dir = path.posix.dirname(relative);
  return {
    relative,
    item: {
      externalId: absolute,
      kind: type.kind,
      mime: type.mime,
      filename: path.basename(absolute),
      path: dir === '.' ? '' : dir,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      etag: `${info.size}-${Math.trunc(info.mtimeMs)}`,
      externalUrl: pathToFileURL(absolute).href,
    },
  };
}

/**
 * Drops files whose etag matches what core already has.
 *
 * @param ctx - Sync context (used for isKnown).
 * @param files - Files scanned in this chunk.
 * @returns Only new or changed items.
 */
export async function changedItems(
  ctx: SyncContext<LocalConfig>,
  files: ScannedFile[],
): Promise<MediaItem[]> {
  const known = await ctx.isKnown(files.map((f) => f.item.externalId));
  return files.map((f) => f.item).filter((item) => known[item.externalId]?.etag !== item.etag);
}
