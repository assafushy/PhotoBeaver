import { defineEnricher, type PluginContext } from '@photobeaver/plugin-sdk';
import { decideExact } from './decide';
import { findExactMatches } from './exact';
import { suggestNearDuplicates } from './near/finalize';
import { perceptualKeys } from './near/hashing';
import { resolveSettings, type DedupSettings } from './settings';

export type { DedupSettings } from './settings';

async function readSettings(ctx: PluginContext): Promise<DedupSettings> {
  return resolveSettings(await ctx.settings<Partial<Record<keyof DedupSettings, unknown>>>());
}

export default defineEnricher<DedupSettings>({
  async enrich(ctx, asset) {
    const settings = await readSettings(ctx);
    const findings = await findExactMatches(ctx, asset, settings);
    const decision = await decideExact(ctx, asset, settings, findings);
    const perceptual = settings.nearDuplicates ? await perceptualKeys(ctx, asset) : [];
    return { identityKeys: [...findings.keys, ...perceptual], ...decision };
  },

  async finalize(ctx) {
    const settings = await readSettings(ctx);
    if (!settings.nearDuplicates) return;
    const count = await suggestNearDuplicates(ctx, settings);
    ctx.log.info('Near-duplicate scan finished', { suggestions: count });
  },
});
