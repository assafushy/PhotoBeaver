import sharp from 'sharp';
import { THUMB_SIZES, type ThumbSize } from './thumb-paths';

export interface RenderedThumbs {
  width: number;
  height: number;
  files: Map<ThumbSize, Buffer>;
}

const WEBP_QUALITY = 80;
const SWAPS_AXES = new Set([5, 6, 7, 8]);

/**
 * Renders the WebP thumbnails for an image. Each size is the shorter edge, so the
 * thumbnail covers a size x size box; images are never enlarged. EXIF orientation
 * is applied.
 *
 * @param input - Encoded image bytes.
 * @returns Upright dimensions and one WebP per size.
 */
export async function renderThumbnails(input: Buffer): Promise<RenderedThumbs> {
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) throw new Error('Image has no dimensions');
  const swap = SWAPS_AXES.has(meta.orientation ?? 1);
  const files = new Map<ThumbSize, Buffer>();
  for (const size of THUMB_SIZES) {
    const buffer = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: size, height: size, fit: 'outside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    files.set(size, buffer);
  }
  return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height, files };
}
