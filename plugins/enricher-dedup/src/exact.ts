import type { AssetView } from '@photobeaver/plugin-sdk';
import { assetsWithKeys, type DedupContext } from './context';
import { comparable, digestFile, digestKeys, type ContentDigest } from './hashes/digest';
import { usesSampledHash } from './hashes/vsample';
import { largestSize, sizeKeys, sourceHashKeys } from './keys';
import type { DedupSettings } from './settings';
import { contentCache, type ContentEntry } from './store';

export interface ExactFindings {
  keys: string[];
  exact: string[];
  sampled: string[];
}

interface Comparison {
  asset: AssetView;
  digest: ContentDigest;
  sampled: boolean;
  sizes: Set<number>;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function instanceSizes(asset: AssetView): Set<number> {
  return new Set(asset.instances.flatMap((i) => (i.sizeBytes === undefined ? [] : [i.sizeBytes])));
}

/**
 * Finds assets with byte-identical content (SPEC 9.4 steps 1 to 3): source hash
 * keys first, then full or sampled hashes when another asset has the same size.
 *
 * @param ctx - Enrich context.
 * @param asset - Asset being enriched.
 * @param settings - Plugin settings.
 * @returns Keys to publish, exact matches and sampled (suggest-only) matches.
 */
export async function findExactMatches(
  ctx: DedupContext,
  asset: AssetView,
  settings: DedupSettings,
): Promise<ExactFindings> {
  const cheap = [...sizeKeys(asset), ...sourceHashKeys(asset)];
  const bySource = await assetsWithKeys(ctx, asset.id, sourceHashKeys(asset));
  const bySize = await assetsWithKeys(ctx, asset.id, sizeKeys(asset));
  if (bySize.length === 0 || !settings.downloadToCompare)
    return { keys: cheap, exact: bySource, sampled: [] };
  const content = await compareContent(
    ctx,
    asset,
    bySize.filter((id) => !bySource.includes(id)),
  );
  return {
    keys: unique([...cheap, ...content.keys]),
    exact: unique([...bySource, ...content.exact]),
    sampled: content.sampled.filter((id) => !bySource.includes(id)),
  };
}

async function compareContent(
  ctx: DedupContext,
  asset: AssetView,
  candidates: string[],
): Promise<ExactFindings> {
  const sampled = usesSampledHash(asset.kind, largestSize(asset));
  const original = await ctx.getInput(asset, { input: 'original' });
  const digest = await digestFile(original.path, sampled, ctx.signal);
  await contentCache.append(ctx.dataDir, toEntry(asset.id, digest));
  const keys = digestKeys(digest);
  const byKey = await assetsWithKeys(ctx, asset.id, keys);
  const comparison: Comparison = { asset, digest, sampled, sizes: instanceSizes(asset) };
  const direct = await compareCandidates(
    ctx,
    comparison,
    candidates.filter((id) => !byKey.includes(id)),
  );
  const matches = unique([...byKey, ...direct]);
  return sampled ? { keys, exact: [], sampled: matches } : { keys, exact: matches, sampled: [] };
}

function toEntry(assetId: string, digest: ContentDigest): ContentEntry {
  return { assetId, size: digest.size, sha256: digest.sha256, vsample: digest.vsample };
}

async function compareCandidates(
  ctx: DedupContext,
  comparison: Comparison,
  candidates: string[],
): Promise<string[]> {
  if (candidates.length === 0) return [];
  const cache = await contentCache.load(ctx.dataDir);
  const target = comparable(comparison.digest, comparison.sampled);
  const matches: string[] = [];
  for (const id of candidates) {
    const cached = cache.get(id);
    const usable =
      cached && comparison.sizes.has(cached.size)
        ? comparable(cached, comparison.sampled)
        : undefined;
    const value = usable ?? (await hashCandidate(ctx, comparison, id));
    if (value !== undefined && value === target) matches.push(id);
  }
  return matches;
}

async function hashCandidate(
  ctx: DedupContext,
  comparison: Comparison,
  id: string,
): Promise<string | undefined> {
  const candidate: AssetView = { id, kind: comparison.asset.kind, instances: [], enrichments: {} };
  try {
    const original = await ctx.getInput(candidate, { input: 'original' });
    const digest = await digestFile(original.path, comparison.sampled, ctx.signal);
    await contentCache.append(ctx.dataDir, toEntry(id, digest));
    return comparable(digest, comparison.sampled);
  } catch (error) {
    ctx.log.warn('Could not read a same-size candidate to compare', {
      assetId: id,
      error: String(error),
    });
    return undefined;
  }
}
