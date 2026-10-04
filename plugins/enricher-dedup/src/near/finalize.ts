import type { DuplicateSuggestion } from '@photobeaver/plugin-sdk';
import type { DedupContext } from '../context';
import { fromHex } from '../image/hash64';
import { KEY_PREFIX } from '../keys';
import type { DedupSettings } from '../settings';
import { nearIndex, suggestedGroups, type NearEntry, type SuggestedMemory } from '../store';
import { clusters, planGroups } from './clusters';
import { isBurst, nearPairs, type HashedAsset, type NearPair } from './pairs';

const BLOCK_CHECK_BATCH = 100;

async function listPerceptual(ctx: DedupContext): Promise<HashedAsset[]> {
  const hashed: HashedAsset[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.assets.listIdentity(KEY_PREFIX.phash, cursor);
    for (const item of page.items) {
      const hash = fromHex(item.key.slice(KEY_PREFIX.phash.length));
      if (hash) hashed.push({ assetId: item.assetId, hash });
    }
    cursor = page.cursor;
  } while (cursor);
  return hashed;
}

async function compactIndex(
  ctx: DedupContext,
  index: Map<string, NearEntry>,
  hashed: HashedAsset[],
): Promise<void> {
  const live = new Set(hashed.map((h) => h.assetId));
  const kept = [...index.values()].filter((entry) => live.has(entry.assetId));
  if (kept.length !== index.size) await nearIndex.rewrite(ctx.dataDir, kept);
}

async function withoutBlocked(ctx: DedupContext, pairs: NearPair[]): Promise<NearPair[]> {
  const kept: NearPair[] = [];
  for (let start = 0; start < pairs.length; start += BLOCK_CHECK_BATCH) {
    const batch = pairs.slice(start, start + BLOCK_CHECK_BATCH);
    const blocked = await Promise.all(batch.map((p) => ctx.assets.isMergeBlocked(p.a, p.b)));
    kept.push(...batch.filter((_, i) => !blocked[i]));
  }
  return kept;
}

async function qualifyingPairs(
  ctx: DedupContext,
  pairs: NearPair[],
  index: Map<string, NearEntry>,
  memory: SuggestedMemory,
): Promise<NearPair[]> {
  const kept = pairs.filter((p) => !memory.together(p.a, p.b) && !isBurst(p, index));
  return withoutBlocked(ctx, kept);
}

function suggestionsFor(pairs: NearPair[], memory: SuggestedMemory): DuplicateSuggestion[] {
  return clusters(pairs).flatMap((cluster) =>
    planGroups(cluster, memory).map((assetIds) => ({
      assetIds,
      kind: 'near' as const,
      confidence: 1 - cluster.maxDistance / 64,
    })),
  );
}

/**
 * Library-wide near-duplicate scan (SPEC 9.4 steps 5 and 6): BK-tree search over
 * every `phash:` key, minus bursts, never-merge pairs and pairs already suggested
 * together, then one suggestion per connected group of look-alikes.
 * Near duplicates are only ever suggested, never merged.
 *
 * @param ctx - Enrich context.
 * @param settings - Plugin settings.
 * @returns How many new suggestions were made.
 */
export async function suggestNearDuplicates(
  ctx: DedupContext,
  settings: DedupSettings,
): Promise<number> {
  const hashed = await listPerceptual(ctx);
  const index = await nearIndex.load(ctx.dataDir);
  await compactIndex(ctx, index, hashed);
  const memory = await suggestedGroups.load(ctx.dataDir);
  const pairs = await qualifyingPairs(
    ctx,
    nearPairs(hashed, settings.nearThreshold),
    index,
    memory,
  );
  const suggestions = suggestionsFor(pairs, memory);
  if (suggestions.length === 0) return 0;
  await ctx.assets.suggestDuplicates(suggestions);
  await suggestedGroups.append(
    ctx.dataDir,
    suggestions.map((s) => s.assetIds),
  );
  return suggestions.length;
}
