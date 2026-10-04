import { defineEnricher, type AssetView, type EnrichmentResult } from '@photobeaver/plugin-sdk';
import { readImageMetadata } from './image';
import { isIsoMedia, readVideoMetadata } from './video';

export {
  exifDateToFloating,
  offsetDateToFloating,
  quickTimeToFloating,
  toFloating,
} from './floating-time';
export { parseIso6709, validLocation } from './geo';

function mimeOf(asset: AssetView, inputMime: string): string {
  return asset.mime ?? inputMime;
}

/**
 * Tells whether the plugin handles an asset: every photo and video.
 *
 * @param asset - The asset.
 * @returns True for image/* and video/*.
 */
export function shouldEnrich(asset: AssetView): boolean {
  const mime = asset.mime?.toLowerCase();
  if (mime) return mime.startsWith('image/') || mime.startsWith('video/');
  return asset.kind === 'image' || asset.kind === 'video';
}

export default defineEnricher({
  shouldEnrich,

  async enrich(ctx, asset): Promise<EnrichmentResult> {
    const input = await ctx.getInput(asset, { input: 'original' });
    const mime = mimeOf(asset, input.mime).toLowerCase();
    if (mime.startsWith('image/')) return readImageMetadata(input.path, ctx.log);
    if (isIsoMedia(mime)) return readVideoMetadata(input.path, ctx.log);
    return {};
  },
});
