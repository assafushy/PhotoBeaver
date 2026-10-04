import type { AssetView, EnrichContext, EnricherPlugin } from '@photobeaver/plugin-sdk';
import type { EnrichOutcome } from '@photobeaver/shared/rpc';

export interface EnricherManifest {
  id: string;
  name: string;
  version: string;
  permissions: { originals: 'none' | 'thumbnail' | 'read'; assets: 'none' | 'merge' };
  enricher: {
    accepts: string[];
    input: 'metadata' | 'thumbnail' | 'original';
    dependsOn: string[];
    produces: string[];
    concurrency: number;
    resourceClass: 'light' | 'cpu-heavy' | 'gpu';
  };
  configSchema?: { properties?: Record<string, { default?: unknown }> };
}

/**
 * How core talks to an enricher: over RPC to a plugin host, or in-process in tests.
 */
export interface EnricherClient {
  enrich(ctx: EnrichContext<unknown>, asset: AssetView): Promise<EnrichOutcome>;
  enrichBatch?(
    ctx: EnrichContext<unknown>,
    assets: AssetView[],
  ): Promise<[string, EnrichOutcome][]>;
  finalize?(ctx: EnrichContext<unknown>): Promise<void>;
  supportsBatch?(): Promise<boolean>;
  supportsFinalize?(): Promise<boolean>;
}

export interface EnricherEntry {
  manifest: EnricherManifest;
  client: EnricherClient;
}

/**
 * Wraps an in-process EnricherPlugin (tests, headless runs) as a client,
 * applying `shouldEnrich` the way the plugin host does.
 *
 * @param plugin - The enricher.
 * @returns A client.
 */
export function inProcessEnricher(plugin: EnricherPlugin<unknown>): EnricherClient {
  return {
    enrich: async (ctx, asset) =>
      plugin.shouldEnrich && !plugin.shouldEnrich(asset)
        ? { skipped: true }
        : { skipped: false, result: await plugin.enrich(ctx, asset) },
    finalize: plugin.finalize ? (ctx) => plugin.finalize!(ctx) : undefined,
  };
}
