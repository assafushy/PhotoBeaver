import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  AssetsApi,
  AssetView,
  DuplicateSuggestion,
  EnrichContext,
  EnricherPlugin,
  EnrichInput,
  EnrichInputOptions,
  EnrichmentResult,
} from '../enricher';
import { emptyRecorder, memoryStorage, recordingLogger, type FakeRecorder } from './fake-context';

export interface FakeInputs {
  thumbnail?: string;
  original?: string;
  png?: string;
  mime?: string;
}

export interface FakeEnrichOptions {
  pluginId?: string;
  settings?: unknown;
  inputs?: Record<string, FakeInputs>;
  defaultInput?: 'thumbnail' | 'original' | 'metadata';
  identity?: Map<string, Set<string>>;
  blockedPairs?: [string, string][];
  dataDir?: string;
  fetch?: typeof fetch;
}

export interface EnrichRecorder extends FakeRecorder {
  suggestions: DuplicateSuggestion[];
  inputs: { assetId: string; options?: EnrichInputOptions }[];
}

export type FakeEnrichContext<Settings> = EnrichContext<Settings> & {
  recorded: EnrichRecorder;
  identity: Map<string, Set<string>>;
};

function pickInput(
  assetId: string,
  options: FakeEnrichOptions,
  request?: EnrichInputOptions,
): EnrichInput {
  const entry = options.inputs?.[assetId] ?? {};
  const kind = request?.input ?? (options.defaultInput === 'original' ? 'original' : 'thumbnail');
  const file = request?.format === 'png' ? entry.png : entry[kind];
  if (!file) throw new Error(`No fake ${request?.format ?? kind} input for asset ${assetId}`);
  return {
    path: file,
    mime: request?.format === 'png' ? 'image/png' : (entry.mime ?? 'application/octet-stream'),
  };
}

function findByIdentity(identity: Map<string, Set<string>>): AssetsApi['findByIdentity'] {
  return async (keys, opts) => {
    const found: Record<string, string[]> = {};
    for (const key of keys) {
      const ids = [...(identity.get(key) ?? [])].filter((id) => id !== opts?.excludeAssetId);
      if (ids.length > 0) found[key] = ids;
    }
    return found;
  };
}

function listIdentity(identity: Map<string, Set<string>>): AssetsApi['listIdentity'] {
  return async (prefix) => ({
    items: [...identity.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([key, ids]) => [...ids].map((assetId) => ({ assetId, key }))),
  });
}

function fakeAssets(
  options: FakeEnrichOptions,
  identity: Map<string, Set<string>>,
  recorded: EnrichRecorder,
): AssetsApi {
  const blocked = new Set(
    (options.blockedPairs ?? []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
  );
  return {
    findByIdentity: findByIdentity(identity),
    listIdentity: listIdentity(identity),
    isMergeBlocked: async (a, b) => blocked.has(`${a}|${b}`),
    suggestDuplicates: async (suggestions) => void recorded.suggestions.push(...suggestions),
  };
}

/**
 * A fake EnrichContext for plugin tests: in-memory storage and identity index,
 * inputs served from files you provide, and recorded suggestions.
 *
 * @param options - Settings, input files per asset, identity index, blocked pairs.
 * @returns The context plus what it recorded.
 */
export function createFakeEnrichContext<Settings>(
  options: FakeEnrichOptions = {},
): FakeEnrichContext<Settings> {
  const recorded: EnrichRecorder = { ...emptyRecorder(), suggestions: [], inputs: [] };
  const identity = options.identity ?? new Map<string, Set<string>>();
  return {
    pluginId: options.pluginId ?? 'com.example.test-enricher',
    log: recordingLogger(recorded.logs),
    storage: memoryStorage(recorded.storage),
    dataDir: options.dataDir ?? mkdtempSync(path.join(tmpdir(), 'pb-enrich-')),
    fetch: options.fetch ?? globalThis.fetch,
    settings: async <T>() => (options.settings ?? {}) as T,
    signal: new AbortController().signal,
    status: (text) => void recorded.statuses.push(text),
    getInput: async (asset, request) => (
      recorded.inputs.push({ assetId: asset.id, options: request }),
      pickInput(asset.id, options, request)
    ),
    assets: fakeAssets(options, identity, recorded),
    recorded,
    identity,
  };
}

/**
 * Applies a result's identity keys to the fake index, as core would.
 *
 * @param ctx - Fake context.
 * @param assetId - Asset the result belongs to.
 * @param result - Enrichment result.
 */
export function recordIdentity(
  ctx: FakeEnrichContext<unknown>,
  assetId: string,
  result: EnrichmentResult,
): void {
  for (const key of result.identityKeys ?? []) {
    if (!ctx.identity.has(key)) ctx.identity.set(key, new Set());
    ctx.identity.get(key)!.add(assetId);
  }
}

/**
 * Runs an enricher over assets in order the way core does: `shouldEnrich`
 * first, then `enrich`, recording identity keys between assets.
 *
 * @param plugin - The enricher.
 * @param assets - Assets to process.
 * @param ctx - Fake context.
 * @returns Results by asset id (skipped assets are absent).
 */
export async function runEnrich<Settings>(
  plugin: EnricherPlugin<Settings>,
  assets: AssetView[],
  ctx: FakeEnrichContext<Settings>,
): Promise<Map<string, EnrichmentResult>> {
  const results = new Map<string, EnrichmentResult>();
  for (const asset of assets) {
    if (plugin.shouldEnrich && !plugin.shouldEnrich(asset)) continue;
    const result = await plugin.enrich(ctx, asset);
    recordIdentity(ctx as FakeEnrichContext<unknown>, asset.id, result);
    results.set(asset.id, result);
  }
  return results;
}
