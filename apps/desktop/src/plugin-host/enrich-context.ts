import type { AssetView, EnrichContext, EnrichInput, IdentityPage } from '@photobeaver/plugin-sdk';
import { CORE_METHODS } from '@photobeaver/shared/rpc';
import { pluginContext, type HostServices } from './context';

async function getInput(
  services: HostServices,
  contextId: string,
  asset: AssetView,
  options?: object,
): Promise<EnrichInput> {
  const input = (await services.peer.request(CORE_METHODS.getInput, {
    contextId,
    assetId: asset.id,
    ...options,
  })) as EnrichInput;
  services.grants.add(input.path);
  return input;
}

function assetsApi(services: HostServices, contextId: string): EnrichContext<unknown>['assets'] {
  const { peer } = services;
  return {
    findByIdentity: async (keys, opts) =>
      (await peer.request(CORE_METHODS.findByIdentity, {
        contextId,
        keys,
        excludeAssetId: opts?.excludeAssetId,
      })) as Record<string, string[]>,
    listIdentity: async (prefix, cursor) =>
      (await peer.request(CORE_METHODS.listIdentity, {
        contextId,
        prefix,
        cursor,
      })) as IdentityPage,
    isMergeBlocked: async (a, b) =>
      (await peer.request(CORE_METHODS.isMergeBlocked, { contextId, a, b })) as boolean,
    suggestDuplicates: async (suggestions) =>
      void (await peer.request(CORE_METHODS.suggestDuplicates, { contextId, suggestions })),
  };
}

/**
 * Enricher `ctx` (SPEC 6.4): input files, settings and the asset identity API,
 * all served by core. Each input file core hands out is added to the folder grants.
 *
 * @param services - Host services.
 * @param contextId - Routes callbacks to the core call.
 * @param signal - Cancellation for the call.
 * @returns The enrich context.
 */
export function enrichContext(
  services: HostServices,
  contextId: string,
  signal: AbortSignal,
): EnrichContext<unknown> {
  return {
    ...pluginContext(services, signal),
    getInput: (asset, options) => getInput(services, contextId, asset, options),
    settings: async <T>() => (await services.peer.request(CORE_METHODS.settings, {})) as T,
    assets: assetsApi(services, contextId),
  };
}
