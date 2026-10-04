import type { EnrichContext } from '@photobeaver/plugin-sdk';
import type { DedupSettings } from './settings';

export type DedupContext = EnrichContext<DedupSettings>;

/**
 * Asset ids (other than the given one) that share any of the keys.
 *
 * @param ctx - Enrich context.
 * @param assetId - Asset to exclude.
 * @param keys - Identity keys to look up.
 * @returns Distinct asset ids.
 */
export async function assetsWithKeys(
  ctx: DedupContext,
  assetId: string,
  keys: string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  const found = await ctx.assets.findByIdentity(keys, { excludeAssetId: assetId });
  return [...new Set(Object.values(found).flat())].filter((id) => id !== assetId);
}
