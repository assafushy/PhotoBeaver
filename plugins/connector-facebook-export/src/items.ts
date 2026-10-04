import type { AlbumRef, MediaItem } from '@photobeaver/plugin-sdk';
import type { ArchiveEntry } from '@photobeaver/plugin-sdk/archive';
import { mediaTypeOf } from './media-types';
import type { MediaRef } from './walk';

function segmentsOf(path: string): string[] {
  return path.split('/');
}

function folderName(path: string): string | undefined {
  return segmentsOf(path).at(-2);
}

/**
 * Builds the change marker for an archive entry.
 *
 * @param entry - The media file's entry.
 * @returns The etag: size and modification time.
 */
export function etagOf(entry: ArchiveEntry): string {
  return `${entry.size}-${entry.modifiedAt ?? ''}`;
}

/**
 * Builds a media item from a reference and the archive entry its uri resolved to.
 *
 * @param ref - What the export JSON says about the media.
 * @param entry - The media file in the archive.
 * @returns The item, or undefined when the file is not a photo or video.
 */
export function buildItem(ref: MediaRef, entry: ArchiveEntry): MediaItem | undefined {
  const type = mediaTypeOf(entry.path);
  if (!type) return undefined;
  return {
    externalId: entry.path,
    kind: type.kind,
    mime: type.mime,
    filename: segmentsOf(entry.path).at(-1),
    path: ref.album?.name ?? folderName(entry.path),
    sizeBytes: entry.size,
    modifiedAt: entry.modifiedAt,
    etag: etagOf(entry),
    capturedAt: ref.capturedAt,
    location: ref.location,
    caption: ref.caption,
    albums: ref.album ? [ref.album] : undefined,
    metadata: { source: ref.source },
  };
}

function mergeAlbums(left: AlbumRef[] = [], right: AlbumRef[] = []): AlbumRef[] | undefined {
  const byId = new Map([...left, ...right].map((album) => [album.externalId, album]));
  return byId.size === 0 ? undefined : [...byId.values()];
}

function pathOf(existing: MediaItem, incoming: MediaItem): string | undefined {
  const preferIncoming = !existing.albums?.length && !!incoming.albums?.length;
  return preferIncoming ? incoming.path : existing.path;
}

/**
 * Merges two sightings of the same media file, e.g. in a post and in an album.
 * The first sighting wins for every field it has; albums are combined.
 *
 * @param existing - The item seen first.
 * @param incoming - The item seen again.
 * @returns The merged item.
 */
export function mergeItems(existing: MediaItem, incoming: MediaItem): MediaItem {
  return {
    ...existing,
    path: pathOf(existing, incoming),
    capturedAt: existing.capturedAt ?? incoming.capturedAt,
    location: existing.location ?? incoming.location,
    caption: existing.caption ?? incoming.caption,
    albums: mergeAlbums(existing.albums, incoming.albums),
  };
}
