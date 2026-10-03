import type { PluginContext } from './context';
import type { ContentHash, GeoPoint, MediaKind } from './media';

export interface AssetInstanceView {
  sourceId: string;
  filename?: string;
  path?: string;
  caption?: string;
  sizeBytes?: number;
  contentHash?: ContentHash;
}

export interface AssetView {
  id: string;
  kind: MediaKind;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  capturedAt?: string;
  location?: GeoPoint;
  instances: AssetInstanceView[];
  enrichments: Record<string, Record<string, unknown>>;
}

export interface EnrichmentTag {
  name: string;
  confidence?: number;
  kind?: 'auto' | 'place';
}

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedFace {
  bbox: FaceBox;
  confidence: number;
  embedding?: number[];
}

export interface DuplicateSuggestion {
  assetIds: string[];
  kind: 'exact' | 'near';
  confidence: number;
}

export interface EnrichmentResult {
  data?: Record<string, unknown>;
  tags?: EnrichmentTag[];
  capturedAt?: string;
  location?: GeoPoint;
  dimensions?: { width: number; height: number; durationMs?: number };
  faces?: DetectedFace[];
  searchText?: string;
  identityKeys?: string[];
  mergeWith?: string[];
  suggestDuplicates?: DuplicateSuggestion[];
}

export interface EnrichInput {
  path: string;
  mime: string;
}

export interface IdentityPage {
  items: { assetId: string; key: string }[];
  cursor?: string;
}

export interface AssetsApi {
  findByIdentity(
    keys: string[],
    opts?: { excludeAssetId?: string },
  ): Promise<Record<string, string[]>>;
  listIdentity(prefix: string, cursor?: string): Promise<IdentityPage>;
  isMergeBlocked(a: string, b: string): Promise<boolean>;
  suggestDuplicates(suggestions: DuplicateSuggestion[]): Promise<void>;
}

export interface EnrichContext<Settings> extends PluginContext {
  getInput(asset: AssetView): Promise<EnrichInput>;
  settings<T = Settings>(): Promise<T>;
  assets: AssetsApi;
}

export interface EnricherPlugin<Settings = unknown> {
  activate?(ctx: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;
  shouldEnrich?(asset: AssetView): boolean;
  enrich(ctx: EnrichContext<Settings>, asset: AssetView): Promise<EnrichmentResult>;
  enrichBatch?(
    ctx: EnrichContext<Settings>,
    assets: AssetView[],
  ): Promise<Map<string, EnrichmentResult>>;
  finalize?(ctx: EnrichContext<Settings>): Promise<void>;
}

/**
 * Declares an enricher plugin. Identity at runtime; exists for type inference.
 *
 * @param plugin - The enricher implementation.
 * @returns The same plugin, typed.
 */
export const defineEnricher = <Settings>(
  plugin: EnricherPlugin<Settings>,
): EnricherPlugin<Settings> => plugin;
