import type { ContentHash, GeoPoint, MediaItem } from '@photobeaver/plugin-sdk';
import { mediaKindOf } from './media-types';
import type { DriveItem } from './types';

/**
 * Graph's file hash: QuickXorHash (base64, as Graph returns it) or SHA-256 when that is all there is.
 *
 * @param item - Drive item.
 * @returns The content hash, or undefined.
 */
export function contentHashOf(item: DriveItem): ContentHash | undefined {
  const hashes = item.file?.hashes;
  if (hashes?.quickXorHash) return { algo: 'quickxor', value: hashes.quickXorHash };
  if (hashes?.sha256Hash) return { algo: 'sha256', value: hashes.sha256Hash.toLowerCase() };
  return undefined;
}

function locationOf(item: DriveItem): GeoPoint | undefined {
  const { latitude, longitude } = item.location ?? {};
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return undefined;
  return { lat: latitude, lon: longitude };
}

function dimensionsOf(item: DriveItem): Pick<MediaItem, 'width' | 'height'> {
  const source = item.image ?? item.video;
  return { width: source?.width, height: source?.height };
}

/**
 * Maps a Graph drive item to a MediaItem.
 *
 * @param item - Drive item from a delta page.
 * @param path - Drive-relative folder of the item, when known.
 * @returns The media item, or null when the item is not a photo or video.
 */
export function toMediaItem(item: DriveItem, path: string | undefined): MediaItem | null {
  const kind = mediaKindOf(item);
  if (!kind) return null;
  return {
    externalId: item.id,
    kind,
    mime: item.file?.mimeType,
    filename: item.name,
    path,
    sizeBytes: item.size,
    ...dimensionsOf(item),
    durationMs: item.video?.duration,
    capturedAt: item.photo?.takenDateTime,
    modifiedAt: item.lastModifiedDateTime,
    etag: item.cTag ?? item.eTag,
    contentHash: contentHashOf(item),
    externalUrl: item.webUrl,
    location: locationOf(item),
  };
}
