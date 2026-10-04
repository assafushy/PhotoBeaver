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
import { isHostAllowed } from '@photobeaver/shared/host-allowlist';
import type { OAuthBroker } from '../oauth/oauth-broker';
import { sourceSecretRef, type SecretsService } from '../secrets/secrets-service';
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
  secrets: SecretsService;
  oauth: OAuthBroker;
  openExternal(url: string): Promise<void>;
  settings(manifest: ConnectorManifest): Record<string, unknown>;
  fetch?: typeof fetch;
}

export interface SyncHooks {
  signal: AbortSignal;
  onProgress(progress: SyncProgress): void;
  isKnown: SyncContext<unknown>['isKnown'];
}

/**
 * Allows `ctx.ui.openExternal` only for https URLs on the plugin's declared hosts,
 * so a plugin can't open arbitrary sites.
 *
 * @param url - URL to open.
 * @param network - The plugin's `permissions.network`.
 */
export function assertExternalUrl(url: string, network: readonly string[]): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !isHostAllowed(parsed.hostname, network))
    throw new Error(`Opening ${parsed.origin} is not allowed by this plugin's permissions`);
}

function networkOf(manifest: ConnectorManifest): string[] {
  const network = manifest.permissions?.network;
  return Array.isArray(network) ? network.filter((host) => typeof host === 'string') : [];
}

function pluginLogger(logger: CoreLog): Logger {
  return {
    debug: (msg, data) => logger.debug(data ?? {}, msg),
    info: (msg, data) => logger.info(data ?? {}, msg),
    warn: (msg, data) => logger.warn(data ?? {}, msg),
    error: (msg, data) => logger.error(data ?? {}, msg),
  };
}

/**
 * Registry of loaded connectors and builder of the core-side `ctx` objects.
 * Entries are plugin-host proxies in the app and in-process plugins in tests.
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

  /**
   * Adds or replaces a loaded connector.
   *
   * @param entry - Manifest and implementation.
   */
  add(entry: ConnectorEntry): void {
    this.entries.set(entry.manifest.id, entry);
  }

  /**
   * Removes a connector (disabled or uninstalled).
   *
   * @param pluginId - Plugin id.
   */
  remove(pluginId: string): void {
    this.entries.delete(pluginId);
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
    const manifest = this.manifestOf(source.pluginId);
    return {
      ...this.pluginContext(source.pluginId, signal),
      sourceId: source.id,
      config: source.config,
      secret: this.secretApi(sourceSecretRef(source.id)),
      oauth: this.oauthApi(manifest, signal),
      ui: this.uiApi(source.id, manifest),
    };
  }

  private manifestOf(pluginId: string): ConnectorManifest {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`Connector ${pluginId} is not loaded`);
    return entry.manifest;
  }

  private secretApi(ref: string): SourceContext<unknown>['secret'] {
    return {
      get: async () => this.deps.secrets.get(ref),
      set: async (value) => this.deps.secrets.set(ref, value),
    };
  }

  private oauthApi(
    manifest: ConnectorManifest,
    signal: AbortSignal,
  ): SourceContext<unknown>['oauth'] {
    const permissions = {
      oauth: manifest.permissions?.oauth === true,
      network: networkOf(manifest),
    };
    const plugin = { id: manifest.id, permissions };
    return {
      authorize: (opts) => this.deps.oauth.authorize(plugin, opts, signal),
      refresh: (opts) => this.deps.oauth.refresh(plugin, opts),
    };
  }

  private uiApi(sourceId: string, manifest: ConnectorManifest): SourceContext<unknown>['ui'] {
    return {
      pickDirectory: this.deps.pickDirectory,
      notify: (msg, level = 'info') =>
        this.deps.logger[level === 'warn' ? 'warn' : level]({ sourceId }, msg),
      openExternal: async (url) => {
        assertExternalUrl(url, networkOf(manifest));
        await this.deps.openExternal(url);
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

  /**
   * Plugin-wide `ctx` parts shared by connectors and enrichers.
   *
   * @param pluginId - Plugin id.
   * @param signal - Cancellation signal.
   * @returns The plugin context.
   */
  pluginContext(pluginId: string, signal: AbortSignal): PluginContext {
    const dataDir = path.join(this.deps.pluginDataRoot, pluginId);
    mkdirSync(dataDir, { recursive: true });
    return {
      pluginId,
      log: pluginLogger(this.deps.logger.child({ pluginId })),
      storage: createPluginStorage(this.deps.db, pluginId),
      dataDir,
      fetch: this.deps.fetch ?? globalThis.fetch,
      settings: async <T>() => this.settingsOf(pluginId) as T,
      signal,
    };
  }

  private settingsOf(pluginId: string): Record<string, unknown> {
    const entry = this.entries.get(pluginId);
    return entry ? this.deps.settings(entry.manifest) : {};
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
