import type { AssetView, EnrichContext } from '@photobeaver/plugin-sdk';
import { enrichOutcomeSchema, HOST_METHODS, type EnrichOutcome } from '@photobeaver/shared/rpc';
import { MINUTE_MS } from '../clock';
import type { EnricherClient } from '../enrich/types';
import type { CallContexts } from './call-contexts';
import type { HostHandle } from './host-handle';

export const ENRICH_TIMEOUT_MS = 5 * MINUTE_MS;
export const FINALIZE_TIMEOUT_MS = 30 * MINUTE_MS;

type Ctx = EnrichContext<unknown>;

/**
 * An enricher in a plugin host (SPEC 6.3), called over RPC. Outcomes are
 * validated in core before use (SPEC 6.5); `enrich` calls time out after 5
 * minutes and a timeout kills the host as a hang.
 */
export class RemoteEnricher implements EnricherClient {
  constructor(
    private readonly handle: HostHandle,
    private readonly contexts: CallContexts,
  ) {}

  enrich(ctx: Ctx, asset: AssetView): Promise<EnrichOutcome> {
    return this.call(ctx, HOST_METHODS.enrich, { asset }, ENRICH_TIMEOUT_MS).then((raw) =>
      enrichOutcomeSchema.parse(raw),
    );
  }

  async enrichBatch(ctx: Ctx, assets: AssetView[]): Promise<[string, EnrichOutcome][]> {
    const raw = (await this.call(ctx, HOST_METHODS.enrichBatch, { assets }, ENRICH_TIMEOUT_MS)) as [
      string,
      unknown,
    ][];
    return raw.map(([id, outcome]) => [id, enrichOutcomeSchema.parse(outcome)]);
  }

  async finalize(ctx: Ctx): Promise<void> {
    await this.call(ctx, HOST_METHODS.finalize, {}, FINALIZE_TIMEOUT_MS);
  }

  /** Whether the plugin implements `enrichBatch` (known once its host started). */
  async supportsBatch(): Promise<boolean> {
    return (await this.handle.connect()).capabilities.enrichBatch;
  }

  /** Whether the plugin implements `finalize`. */
  async supportsFinalize(): Promise<boolean> {
    return (await this.handle.connect()).capabilities.finalize;
  }

  private call(ctx: Ctx, method: string, extra: object, timeoutMs: number): Promise<unknown> {
    return this.handle.track(async (connection) => {
      const { contextId, release } = this.contexts.open(ctx);
      try {
        return await connection.peer.request(
          method,
          { contextId, ...extra },
          { timeoutMs, signal: ctx.signal },
        );
      } finally {
        release();
      }
    });
  }
}
