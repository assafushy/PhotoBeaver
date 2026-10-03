import path from 'node:path';

export const THUMB_SIZES = [256, 1024] as const;
export type ThumbSize = (typeof THUMB_SIZES)[number];

/**
 * Location of a thumbnail file: `thumbs/<last 2 chars of id>/<id>_<size>.webp`.
 * The last two characters of a ULID are random, so files spread evenly.
 *
 * @param thumbsDir - Library thumbs folder.
 * @param assetId - Asset id.
 * @param size - Thumbnail size (shorter edge in pixels).
 * @returns Absolute file path.
 */
export function thumbPath(thumbsDir: string, assetId: string, size: ThumbSize): string {
  return path.join(thumbsDir, assetId.slice(-2).toLowerCase(), `${assetId}_${size}.webp`);
}

/**
 * Narrows a number to a supported thumbnail size.
 *
 * @param size - Candidate size.
 * @returns True for 256 or 1024.
 */
export function isThumbSize(size: number): size is ThumbSize {
  return (THUMB_SIZES as readonly number[]).includes(size);
}
