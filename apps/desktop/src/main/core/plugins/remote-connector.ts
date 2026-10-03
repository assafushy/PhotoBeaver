import type {
  ConnectorPlugin,
  ItemRef,
  SourceContext,
  SourceSetupResult,
  SyncBatch,
  SyncContext,
  Unsubscribe,
} from '@photobeaver/plugin-sdk';
import type { ConfigSchema } from '@photobeaver/shared';
import { HOST_METHODS } from '@photobeaver/shared/rpc';
import { ulid } from 'ulid';
import { MINUTE_MS } from '../clock';
import type { CallContexts } from './call-contexts';
import type { Connection, HostHandle } from './host-handle';

export const SETUP_TIMEOUT_MS = 10 * MINUTE_MS;
export const TEST_TIMEOUT_MS = MINUTE_MS;
export const SYNC_INACTIVITY_MS = 10 * MINUTE_MS;
export const BYTES_INACTIVITY_MS = 5 * MINUTE_MS;

type Ctx = SourceContext<unknown>;

/**
 * Folders a source config grants: values of `format: "directory"` fields (SPEC 6.6).
 *
 * @param schema - The plugin's configSchema.
 * @param config - A source config.
 * @returns Granted absolute folders.
 */
export function grantedDirsOf(schema: ConfigSchema, config: unknown): string[] {
  const values = (config ?? {}) as Record<string, unknown>;
  return Object.entries(schema.properties ?? {})
    .filter(([key, field]) => field.format === 'directory' && typeof values[key] === 'string')
    .map(([key]) => values[key] as string);
}

/**
 * A connector that lives in a plugin host. Implements the SDK interface by RPC,
 * so core services call it exactly like an in-process plugin.
 */
export class RemoteConnector implements ConnectorPlugin<unknown> {
  constructor(
    private readonly handle: HostHandle,
    private readonly contexts: CallContexts,
    private readonly configSchema: ConfigSchema,
  ) {}

  setupSource(ctx: Ctx): Promise<SourceSetupResult> {
    return this.call(ctx, HOST_METHODS.setupSource, {}, SETUP_TIMEOUT_MS);
  }

  async testSource(ctx: Ctx): Promise<void> {
    await this.call(ctx, HOST_METHODS.testSource, {}, TEST_TIMEOUT_MS);
  }

  sync(ctx: SyncContext<unknown>, cursor: string | null): AsyncIterable<SyncBatch> {
    return this.stream<SyncBatch>(ctx, HOST_METHODS.sync, { cursor }, SYNC_INACTIVITY_MS);
  }

  async getOriginal(ctx: Ctx, item: ItemRef): Promise<ReadableStream<Uint8Array>> {
    const chunks = this.stream<Uint8Array>(
      ctx,
      HOST_METHODS.getOriginal,
      { item },
      BYTES_INACTIVITY_MS,
    );
    return ReadableStream.from(chunks);
  }

  async getThumbnail(
    ctx: Ctx,
    item: ItemRef,
    size: number,
  ): Promise<ReadableStream<Uint8Array> | null> {
    const stream = this.stream<unknown>(
      ctx,
      HOST_METHODS.getThumbnail,
      { item, size },
      BYTES_INACTIVITY_MS,
    );
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done || !(first.value as { found?: boolean }).found) {
      await iterator.return?.();
      return null;
    }
    return ReadableStream.from({
      [Symbol.asyncIterator]: () => iterator as AsyncIterator<Uint8Array>,
    });
  }

  async watch(
    ctx: SyncContext<unknown>,
    onChange: (batch: SyncBatch) => void,
  ): Promise<Unsubscribe> {
    const watchId = ulid();
    const opened = this.contexts.open(ctx);
    this.contexts.addWatch(watchId, onChange);
    this.handle.watchCount++;
    const release = () => (
      this.contexts.removeWatch(watchId),
      opened.release(),
      this.handle.watchCount--
    );
    try {
      await this.handle.track((c) =>
        c.peer.request(
          HOST_METHODS.watch,
          { ...this.base(ctx, opened.contextId), watchId },
          { timeoutMs: TEST_TIMEOUT_MS },
        ),
      );
    } catch (error) {
      release();
      throw error;
    }
    return () => this.unwatch(watchId, release);
  }

  private unwatch(watchId: string, release: () => void): void {
    release();
    if (this.handle.isRunning)
      void this.handle
        .track((c) => c.peer.request(HOST_METHODS.unwatch, { watchId }))
        .catch(() => undefined);
  }

  private base(ctx: Ctx, contextId: string) {
    return {
      contextId,
      sourceId: ctx.sourceId,
      config: ctx.config,
      grantedDirs: grantedDirsOf(this.configSchema, ctx.config),
    };
  }

  private call<T>(ctx: Ctx, method: string, extra: object, timeoutMs: number): Promise<T> {
    return this.handle.track(async (connection: Connection) => {
      const { contextId, release } = this.contexts.open(ctx);
      try {
        return await connection.peer.request<T>(
          method,
          { ...this.base(ctx, contextId), ...extra },
          { timeoutMs, signal: ctx.signal },
        );
      } finally {
        release();
      }
    });
  }

  private stream<T>(
    ctx: Ctx,
    method: string,
    extra: object,
    inactivityMs: number,
  ): AsyncIterable<T> {
    const self = this;
    return this.handle.trackStream(async function* (connection: Connection) {
      const { contextId, release } = self.contexts.open(ctx);
      try {
        yield* connection.peer.stream<T>(
          method,
          { ...self.base(ctx, contextId), ...extra },
          { inactivityMs, signal: ctx.signal },
        );
      } finally {
        release();
      }
    });
  }
}
