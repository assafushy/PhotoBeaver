import type { LibraryDb } from '@photobeaver/db';
import type { EnrichContext } from '@photobeaver/plugin-sdk';
import type { ConfigSchema } from '@photobeaver/shared';
import { isMergeBlocked } from '../assets/merge';
import type { ConnectorRegistry } from '../connectors/registry';
import { findByIdentity, listIdentity, storeSuggestions } from './identity';
import type { InputProvider } from './input-provider';
import type { PluginSettings } from './plugin-settings';
import type { EnricherManifest } from './types';

export interface EnrichContextDeps {
  db: LibraryDb;
  registry: ConnectorRegistry;
  inputs: InputProvider;
  settings: PluginSettings;
  now: () => number;
}

export interface EnrichJobScope {
  manifest: EnricherManifest;
  assetIds: ReadonlySet<string>;
}

function requireMerge(manifest: EnricherManifest): void {
  if (manifest.permissions.assets !== 'merge')
    throw new Error('This plugin is not allowed to use the asset identity API');
}

function assetsApi(
  deps: EnrichContextDeps,
  manifest: EnricherManifest,
): EnrichContext<unknown>['assets'] {
  const guarded =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    async (...args: A): Promise<R> => (requireMerge(manifest), fn(...args));
  return {
    findByIdentity: guarded((keys: string[], opts?: { excludeAssetId?: string }) =>
      findByIdentity(deps.db, keys, opts?.excludeAssetId),
    ),
    listIdentity: guarded((prefix: string, cursor?: string) =>
      listIdentity(deps.db, prefix, cursor),
    ),
    isMergeBlocked: guarded((a: string, b: string) => isMergeBlocked(deps.db, a, b)),
    suggestDuplicates: guarded(
      (s: Parameters<typeof storeSuggestions>[2]) =>
        void storeSuggestions(deps.db, manifest.id, s, deps.now()),
    ),
  };
}

/**
 * Core-side `EnrichContext` for one job (SPEC 6.4): inputs, settings and the
 * identity API (only with `assets: "merge"`). Inputs of assets other than the
 * ones being enriched (a duplicate candidate) also need `assets: "merge"`. Temp files it creates are
 * collected so the runner can delete them afterwards.
 *
 * @param deps - Database, registry, input provider and settings.
 * @param job - The enricher's manifest and the assets this job enriches.
 * @param signal - Job cancellation.
 * @param tempFiles - Receives temporary files to delete.
 * @returns The context.
 */
export function createEnrichContext(
  deps: EnrichContextDeps,
  job: EnrichJobScope,
  signal: AbortSignal,
  tempFiles: string[],
): EnrichContext<unknown> {
  const { manifest } = job;
  const schema = (manifest.configSchema ?? {}) as ConfigSchema;
  return {
    ...deps.registry.pluginContext(manifest.id, signal),
    getInput: async (asset, options) => {
      if (!job.assetIds.has(asset.id)) requireMerge(manifest);
      return deps.inputs.get({
        manifest,
        assetId: asset.id,
        options: options ?? {},
        signal,
        tempFiles,
      });
    },
    settings: async <T>() => deps.settings.get(manifest.id, schema) as T,
    assets: assetsApi(deps, manifest),
  };
}
