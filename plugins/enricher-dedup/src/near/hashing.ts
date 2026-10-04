import type { AssetView } from '@photobeaver/plugin-sdk';
import type { DedupContext } from '../context';
import { readGrayPng } from '../image/gray';
import { toHex } from '../image/hash64';
import { dHash, pHash } from '../image/perceptual';
import { KEY_PREFIX } from '../keys';
import { nearIndex } from '../store';

/**
 * Computes pHash and dHash from a PNG of the asset's thumbnail, records the
 * pHash and capture time in the near-duplicate index (SPEC 9.4 step 5).
 *
 * @param ctx - Enrich context.
 * @param asset - Asset being enriched.
 * @returns The `phash:` and `dhash:` keys.
 */
export async function perceptualKeys(ctx: DedupContext, asset: AssetView): Promise<string[]> {
  const input = await ctx.getInput(asset, { input: 'thumbnail', format: 'png' });
  const image = await readGrayPng(input.path);
  const phash = toHex(pHash(image));
  const dhash = toHex(dHash(image));
  await nearIndex.append(ctx.dataDir, { assetId: asset.id, phash, capturedAt: asset.capturedAt });
  return [`${KEY_PREFIX.phash}${phash}`, `${KEY_PREFIX.dhash}${dhash}`];
}
