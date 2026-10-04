import type { MediaItem } from '@photobeaver/plugin-sdk';
import type { ArchiveEntry } from '@photobeaver/plugin-sdk/archive';
import { mediaTypeOf } from './media-types';
import type { MediaRef } from './walk';

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
  const segments = entry.path.split('/');
  return {
    externalId: entry.path,
    kind: type.kind,
    mime: type.mime,
    filename: segments.at(-1),
    path: segments.at(-2),
    sizeBytes: entry.size,
    modifiedAt: entry.modifiedAt,
    etag: etagOf(entry),
    capturedAt: ref.capturedAt,
    location: ref.location,
    caption: ref.caption,
    metadata: { source: ref.source },
  };
}

/**
 * Merges two sightings of the same media file. The first sighting wins for every
 * field it has.
 *
 * @param existing - The item seen first.
 * @param incoming - The item seen again.
 * @returns The merged item.
 */
export function mergeItems(existing: MediaItem, incoming: MediaItem): MediaItem {
  return {
    ...existing,
    capturedAt: existing.capturedAt ?? incoming.capturedAt,
    location: existing.location ?? incoming.location,
    caption: existing.caption ?? incoming.caption,
  };
}
