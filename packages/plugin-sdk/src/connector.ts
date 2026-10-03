import type { PluginContext, SourceContext, SyncContext } from './context';
import type { ItemRef, SyncBatch } from './media';

export interface SourceSetupResult {
  displayName: string;
  secret?: Record<string, unknown>;
}

export type Unsubscribe = () => void;

export interface ConnectorPlugin<Config = unknown> {
  activate?(ctx: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;
  setupSource(ctx: SourceContext<Config>): Promise<SourceSetupResult>;
  testSource?(ctx: SourceContext<Config>): Promise<void>;
  sync(ctx: SyncContext<Config>, cursor: string | null): AsyncIterable<SyncBatch>;
  getThumbnail?(
    ctx: SourceContext<Config>,
    item: ItemRef,
    size: number,
  ): Promise<ReadableStream<Uint8Array> | null>;
  getOriginal(ctx: SourceContext<Config>, item: ItemRef): Promise<ReadableStream<Uint8Array>>;
  watch?(ctx: SyncContext<Config>, onChange: (batch: SyncBatch) => void): Promise<Unsubscribe>;
}

/**
 * Declares a connector plugin. Identity at runtime; exists for type inference.
 *
 * @param plugin - The connector implementation.
 * @returns The same plugin, typed.
 */
export const defineConnector = <Config>(plugin: ConnectorPlugin<Config>): ConnectorPlugin<Config> =>
  plugin;
