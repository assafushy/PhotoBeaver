import type { AssetView, DuplicateSuggestion, EnrichmentResult } from '@photobeaver/plugin-sdk';
import type { DedupContext } from './context';
import type { ExactFindings } from './exact';
import type { DedupSettings } from './settings';
import { MAX_GROUP_SIZE, suggestedGroups } from './store';

export const SAMPLED_CONFIDENCE = 0.99;

type ExactResult = Pick<EnrichmentResult, 'mergeWith' | 'suggestDuplicates'>;

async function allowed(ctx: DedupContext, assetId: string, ids: string[]): Promise<string[]> {
  const blocked = await Promise.all(ids.map((id) => ctx.assets.isMergeBlocked(assetId, id)));
  return ids.filter((_, i) => !blocked[i]);
}

async function unsuggested(ctx: DedupContext, assetId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const memory = await suggestedGroups.load(ctx.dataDir);
  return ids.filter((id) => !memory.together(assetId, id)).slice(0, MAX_GROUP_SIZE - 1);
}

async function suggestion(
  ctx: DedupContext,
  assetId: string,
  ids: string[],
  confidence: number,
): Promise<DuplicateSuggestion[]> {
  const fresh = await unsuggested(ctx, assetId, ids);
  if (fresh.length === 0) return [];
  await suggestedGroups.append(ctx.dataDir, [[assetId, ...fresh]]);
  return [{ assetIds: [assetId, ...fresh], kind: 'exact', confidence }];
}

/**
 * Turns exact findings into merges or suggestions (SPEC 9.4 step 4). Pairs on
 * the never-merge list are skipped entirely, and sampled matches are only suggested.
 *
 * @param ctx - Enrich context.
 * @param asset - Asset being enriched.
 * @param settings - Plugin settings.
 * @param findings - Exact and sampled matches.
 * @returns `mergeWith` and `suggestDuplicates`, each present only when non-empty.
 */
export async function decideExact(
  ctx: DedupContext,
  asset: AssetView,
  settings: DedupSettings,
  findings: ExactFindings,
): Promise<ExactResult> {
  const exact = await allowed(ctx, asset.id, findings.exact);
  const sampled = await allowed(
    ctx,
    asset.id,
    findings.sampled.filter((id) => !exact.includes(id)),
  );
  const merge = settings.exactMerge === 'auto' ? exact : [];
  const suggestions = [
    ...(merge.length === 0 ? await suggestion(ctx, asset.id, exact, 1) : []),
    ...(await suggestion(ctx, asset.id, sampled, SAMPLED_CONFIDENCE)),
  ];
  return {
    ...(merge.length > 0 ? { mergeWith: merge } : {}),
    ...(suggestions.length > 0 ? { suggestDuplicates: suggestions } : {}),
  };
}
