import {
  defineEnricher,
  type AssetView,
  type EnrichContext,
  type EnricherPlugin,
  type EnrichmentResult,
} from '@photobeaver/plugin-sdk';
import { analyzeImage } from './analyze';
import { defaultThreads } from './embed/onnx';
import { FaceEngine, type EngineOptions } from './engine';
import { readPng } from './image/rgb';
import { BUFFALO_L, DEFAULT_RETRY } from './models/source';
import { resolveSettings, type FacesSettings } from './settings';

export type FacesEnricherOptions = Partial<EngineOptions>;

export interface FacesEnricher extends EnricherPlugin<FacesSettings> {
  /** Resolves with the models folder once the models are downloaded and verified. */
  modelsReady(): Promise<string>;
}

type Ctx = EnrichContext<FacesSettings>;

async function enrichOne(
  engine: FaceEngine,
  ctx: Ctx,
  asset: AssetView,
): Promise<EnrichmentResult> {
  engine.start(ctx);
  const sessions = await engine.getSessions();
  const raw = await ctx.settings<Partial<Record<keyof FacesSettings, unknown>>>();
  const input = await ctx.getInput(asset, { format: 'png' });
  const faces = await analyzeImage(await readPng(input.path), sessions, resolveSettings(raw));
  return { faces };
}

async function enrichMany(engine: FaceEngine, ctx: Ctx, assets: AssetView[]) {
  const results = new Map<string, EnrichmentResult>();
  for (const asset of assets) results.set(asset.id, await enrichOne(engine, ctx, asset));
  return results;
}

/**
 * Builds the Faces enricher. The default export uses the InsightFace buffalo_l
 * release; tests inject a local model source and short retry delays.
 *
 * @param options - Model source, retry policy and thread count overrides.
 * @returns The enricher.
 */
export function createFacesEnricher(options: FacesEnricherOptions = {}): FacesEnricher {
  const engine = new FaceEngine({
    models: options.models ?? BUFFALO_L,
    retry: options.retry ?? DEFAULT_RETRY,
    threads: options.threads ?? defaultThreads(),
  });
  const plugin = defineEnricher<FacesSettings>({
    activate: async (ctx) => engine.start(ctx),
    deactivate: () => engine.stop(),
    enrich: (ctx, asset) => enrichOne(engine, ctx, asset),
    enrichBatch: (ctx, assets) => enrichMany(engine, ctx, assets),
  });
  return { ...plugin, modelsReady: () => engine.whenReady() };
}
