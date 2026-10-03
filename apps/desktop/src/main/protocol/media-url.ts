import { isThumbSize, type ThumbSize } from '../core/thumbnails/thumb-paths';

export const PB_MEDIA_SCHEME = 'pb-media';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type MediaRequest =
  { kind: 'thumb'; assetId: string; size: ThumbSize } | { kind: 'original'; assetId: string };

/**
 * Parses and validates a `pb-media://` URL. Anything unexpected is rejected, so
 * request data never reaches the filesystem unvalidated.
 *
 * @param url - The request URL.
 * @returns The parsed request, or null when invalid.
 */
export function parseMediaUrl(url: string): MediaRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${PB_MEDIA_SCHEME}:`) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const assetId = (parts[0] ?? '').toUpperCase();
  if (!ULID.test(assetId)) return null;
  if (parsed.hostname === 'original' && parts.length === 1) return { kind: 'original', assetId };
  const size = Number(parts[1]);
  if (parsed.hostname === 'thumb' && parts.length === 2 && isThumbSize(size))
    return { kind: 'thumb', assetId, size };
  return null;
}
