import type { AssetView, EnricherPlugin, EnrichmentResult } from '@photobeaver/plugin-sdk';
import {
  enrichBatchCallSchema,
  enrichCallSchema,
  finalizeCallSchema,
  HOST_METHODS,
  validatorOf,
  type EnrichOutcome,
} from '@photobeaver/shared/rpc';
import type { HostServices } from './context';
import { enrichContext } from './enrich-context';

type Enricher = EnricherPlugin<unknown>;
type EnrichCall = { contextId: string; asset: AssetView };
type BatchCall = { contextId: string; assets: AssetView[] };

async function enrichOne(
  services: HostServices,
  plugin: Enricher,
  call: EnrichCall,
  signal: AbortSignal,
): Promise<EnrichOutcome> {
  if (plugin.shouldEnrich && !plugin.shouldEnrich(call.asset)) return { skipped: true };
  const result = await plugin.enrich(enrichContext(services, call.contextId, signal), call.asset);
  return { skipped: false, result };
}

async function enrichMany(
  services: HostServices,
  plugin: Enricher,
  call: BatchCall,
  signal: AbortSignal,
): Promise<[string, EnrichOutcome][]> {
  const wanted = call.assets.filter((asset) => !plugin.shouldEnrich || plugin.shouldEnrich(asset));
  const results: Map<string, EnrichmentResult> = wanted.length
    ? await plugin.enrichBatch!(enrichContext(services, call.contextId, signal), wanted)
    : new Map();
  return call.assets.map((asset) => {
    const result = results.get(asset.id);
    return [asset.id, result ? { skipped: false, result } : { skipped: true }];
  });
}

function registerBatch(services: HostServices, plugin: Enricher): void {
  services.peer.handle(
    HOST_METHODS.enrichBatch,
    (call, { signal }) => enrichMany(services, plugin, call as BatchCall, signal),
    validatorOf(enrichBatchCallSchema),
  );
}

function registerFinalize(services: HostServices, plugin: Enricher): void {
  services.peer.handle(
    HOST_METHODS.finalize,
    async (call, { signal }) => {
      await plugin.finalize!(
        enrichContext(services, (call as { contextId: string }).contextId, signal),
      );
    },
    validatorOf(finalizeCallSchema),
  );
}

/**
 * Serves an enricher over RPC (SPEC 6.3): `shouldEnrich` runs here before
 * `enrich`, so filtering costs no extra round trip; batch and finalize when supported.
 *
 * @param services - Host services.
 * @param plugin - The loaded enricher.
 */
export function registerEnricher(services: HostServices, plugin: Enricher): void {
  services.peer.handle(
    HOST_METHODS.enrich,
    (call, { signal }) => enrichOne(services, plugin, call as EnrichCall, signal),
    validatorOf(enrichCallSchema),
  );
  if (plugin.enrichBatch) registerBatch(services, plugin);
  if (plugin.finalize) registerFinalize(services, plugin);
}
