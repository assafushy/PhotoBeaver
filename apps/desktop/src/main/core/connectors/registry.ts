import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { schema, type LibraryDb } from '@photobeaver/db';
import type {
  ConnectorPlugin,
  Logger,
  PluginContext,
  SourceContext,
  SyncContext,
  SyncProgress,
} from '@photobeaver/plugin-sdk';
import type { ConnectorManifest } from './manifest';
import { createPluginStorage } from './plugin-storage';

type SourceRow = typeof schema.sources.$inferSelect;

export interface ConnectorEntry {
  manifest: ConnectorManifest;
  plugin: ConnectorPlugin<unknown>;
}

export interface CoreLog {
  child(bindings: object): CoreLog;
  debug(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface RegistryDeps {
  db: LibraryDb;
  pluginDataRoot: string;
  logger: CoreLog;
  pickDirectory: () => Promise<string | null>;
}

export interface SyncHooks {
  signal: AbortSignal;
  onProgress(progress: SyncProgress): void;
  isKnown: SyncContext<unknown>['isKnown'];
}

const unavailable = (feature: string) => async (): Promise<never> => {
  throw new Error(`${feature} is not available until a later milestone`);
};

function pluginLogger(logger: CoreLog): Logger {
  return {
    debug: (msg, data) => logger.debug(data ?? {}, msg),
    info: (msg, data) => logger.info(data ?? {}, msg),
    warn: (msg, data) => logger.warn(data ?? {}, msg),
    error: (msg, data) => logger.error(data ?? {}, msg),
  };
}

/**
 * In-process registry of builtin connectors (M1). Builds the `ctx` objects that
 * plugins see; M2 replaces the in-process calls with plugin hosts over RPC.
 */
export class ConnectorRegistry {
  private readonly entries = new Map<string, ConnectorEntry>();

  constructor(
    entries: ConnectorEntry[],
    private readonly deps: RegistryDeps,
  ) {
    for (const entry of entries) this.entries.set(entry.manifest.id, entry);
  }

  /**
   * Upserts a `plugins` row for every builtin connector.
   *
   * @param now - Current time.
   */
  registerBuiltins(now: number): void {
    for (const { manifest } of this.entries.values()) this.upsertPluginRow(manifest, now);
  }

  get(pluginId: string): ConnectorEntry | undefined {
    return this.entries.get(pluginId);
  }

  list(): ConnectorEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Builds a SourceContext for a source (or a draft during setup).
   *
   * @param source - Source id, plugin id and config.
   * @param signal - Cancellation signal.
   * @returns The context.
   */
  sourceContext(
    source: Pick<SourceRow, 'id' | 'pluginId'> & { config: unknown },
    signal: AbortSignal,
  ): SourceContext<unknown> {
    return {
      ...this.pluginContext(source.pluginId, signal),
      sourceId: source.id,
      config: source.config,
      secret: { get: async () => undefined, set: unavailable('Secret storage') },
      oauth: { authorize: unavailable('OAuth'), refresh: unavailable('OAuth') },
      ui: {
        pickDirectory: this.deps.pickDirectory,
        notify: (msg, level = 'info') =>
          this.deps.logger[level === 'warn' ? 'warn' : level]({ sourceId: source.id }, msg),
      },
    };
  }

  /**
   * Builds a SyncContext wired to the sync runner's hooks.
   *
   * @param source - Source row.
   * @param hooks - Signal, progress and isKnown from the runner.
   * @returns The context.
   */
  syncContext(source: SourceRow, hooks: SyncHooks): SyncContext<unknown> {
    const config = JSON.parse(source.configJson) as unknown;
    return {
      ...this.sourceContext({ ...source, config }, hooks.signal),
      reportProgress: hooks.onProgress,
      isKnown: hooks.isKnown,
    };
  }

  private pluginContext(pluginId: string, signal: AbortSignal): PluginContext {
    const dataDir = path.join(this.deps.pluginDataRoot, pluginId);
    mkdirSync(dataDir, { recursive: true });
    return {
      pluginId,
      log: pluginLogger(this.deps.logger.child({ pluginId })),
      storage: createPluginStorage(this.deps.db, pluginId),
      dataDir,
      fetch: globalThis.fetch,
      settings: async <T>() => ({}) as T,
      signal,
    };
  }

  private upsertPluginRow(manifest: ConnectorManifest, now: number): void {
    const values = {
      version: manifest.version,
      manifestJson: JSON.stringify(manifest),
      grantedPermissionsJson: JSON.stringify(manifest.permissions ?? {}),
      updatedAt: now,
    };
    this.deps.db
      .insert(schema.plugins)
      .values({
        id: manifest.id,
        type: 'connector',
        installSource: 'builtin',
        installedAt: now,
        ...values,
      })
      .onConflictDoUpdate({ target: schema.plugins.id, set: values })
      .run();
  }
}
