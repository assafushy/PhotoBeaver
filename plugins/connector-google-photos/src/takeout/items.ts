import type { Logger, MediaItem } from '@photobeaver/plugin-sdk';
import type { ArchiveEntry, ArchiveTree } from '@photobeaver/plugin-sdk/archive';
import { mediaTypeOf } from '../media-types';
import type { TakeoutItem } from './catalog';
import { splitPath } from './folders';
import { sidecarFields, type SidecarFields, type TakeoutSidecar } from './metadata';

/**
 * Change-detection tag of an archive entry.
 *
 * @param entry - Archive entry.
 * @returns `<size>-<modifiedAt>`.
 */
export function etagOf(entry: ArchiveEntry): string {
  return `${entry.size}-${entry.modifiedAt ?? ''}`;
}

async function readFields(tree: ArchiveTree, item: TakeoutItem, log: Logger) {
  if (!item.sidecar) return {};
  try {
    return sidecarFields(await tree.readJson<TakeoutSidecar>(item.sidecar));
  } catch (error) {
    log.warn('Skipped an unreadable sidecar', { path: item.sidecar, error: String(error) });
    return {};
  }
}

function assemble(item: TakeoutItem, fields: SidecarFields): MediaItem {
  const { title, ...rest } = fields;
  const type = mediaTypeOf(item.entry.path)!;
  return {
    externalId: item.externalId,
    kind: type.kind,
    mime: type.mime,
    filename: splitPath(item.entry.path).name,
    path: item.folder,
    sizeBytes: item.entry.size,
    ...(item.entry.modifiedAt ? { modifiedAt: item.entry.modifiedAt } : {}),
    etag: etagOf(item.entry),
    ...rest,
    ...(item.albums.length > 0 ? { albums: item.albums } : {}),
    metadata: title ? { title } : {},
  };
}

/**
 * Builds the media item of a Takeout photo or video, reading its JSON sidecar.
 *
 * @param tree - The open archive.
 * @param item - Catalog item.
 * @param log - Logger for unreadable sidecars.
 * @returns The media item.
 */
export async function toMediaItem(
  tree: ArchiveTree,
  item: TakeoutItem,
  log: Logger,
): Promise<MediaItem> {
  return assemble(item, await readFields(tree, item, log));
}
