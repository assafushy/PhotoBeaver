import { readFileSync } from 'node:fs';
import path from 'node:path';
import { schema, type LibraryDb } from '@photobeaver/db';
import type { PluginSummary, StagedPackageSummary } from '@photobeaver/shared';
import type { PluginManifest } from '@photobeaver/shared/manifest';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { writeAudit } from '../audit';
import { MINUTE_MS, systemClock, type Clock } from '../clock';
import type { ConnectorRegistry, CoreLog } from '../connectors/registry';
import type { EventSink } from '../events/event-sink';
import { bundledPlugins, compareVersions, type BundledPlugin } from './default-plugins';
import { loadPlugin, type LoadedPlugin, type LoaderDeps } from './plugin-loader';
import type { EnricherRegistry } from '../enrich/enricher-registry';
import { pluginRows, type InstallSource, type PluginRow } from './plugin-rows';
import { pluginSummary, stagedSummary } from './plugin-summary';
import { readManifest, type PluginStore, type StagedPackage } from './plugin-store';
import type { WatchManager } from './watch-manager';

export interface PluginManagerDeps {
  db: LibraryDb;
  store: PluginStore;
  registry: ConnectorRegistry;
  watches: WatchManager;
  events: EventSink;
  logger: CoreLog;
  loader: Omit<LoaderDeps, 'onStarted' | 'onCrashed' | 'store'>;
  defaultsDir: string;
  logsDir: string;
  removeSources(pluginId: string, userId: string): Promise<void>;
  enrichers: EnricherRegistry;
  enrichLibrary(pluginId: string): void;
  queueSize(pluginId: string): number;
  clock?: Clock;
}

interface InstallOptions {
  source: InstallSource;
  userId: string | null;
  copy: boolean;
  verify: boolean;
}

/**
 * Plugin lifecycle (SPEC 5.4, 7.6, 9.1): default plugins, install with
 * verification and rollback, enable, disable, uninstall, crash state, staged
 * packages awaiting consent, and developer reloads.
 */
export class PluginManager {
  private readonly loaded = new Map<string, LoadedPlugin>();
  private readonly errors = new Map<string, string>();
  private readonly staged = new Map<string, StagedPackage>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: PluginManagerDeps) {}

  /** Installs or upgrades default plugins, loads enabled plugins, starts the idle sweep. */
  start(): void {
    const fresh = this.installDefaults().filter((b) => b.isNew);
    for (const row of pluginRows.list(this.deps.db))
      if (row.enabled && row.installPath) this.load(row.id);
    fresh.forEach((b) => this.enrichLibraryIfEnricher(b.manifest.id));
    this.sweepTimer = setInterval(() => void this.sweepIdle(), MINUTE_MS);
    this.sweepTimer.unref?.();
  }

  /** Stops every plugin host (quit). */
  async stop(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.deps.watches.stopAll();
    await Promise.all([...this.loaded.values()].map((p) => p.handle.stop()));
  }

  list(): PluginSummary[] {
    const defaults = new Set(this.bundled().map((b) => b.manifest.id));
    return pluginRows.list(this.deps.db).map((row) => this.summaryOf(row, defaults.has(row.id)));
  }

  summary(id: string): PluginSummary {
    const row = this.requireRow(id);
    return this.summaryOf(
      row,
      this.bundled().some((b) => b.manifest.id === id),
    );
  }

  /**
   * Validates and stages a `.pbplugin` for the consent dialog.
   *
   * @param file - Package path.
   * @returns Manifest, permissions and hash to show.
   */
  inspectPackage(file: string): StagedPackageSummary {
    const staged = this.deps.store.stage(file);
    const token = ulid();
    this.staged.set(token, staged);
    return stagedSummary(
      token,
      staged,
      pluginRows.get(this.deps.db, staged.manifest.id)?.version ?? null,
    );
  }

  /**
   * Installs a staged package after the user consented.
   *
   * @param token - Staging token.
   * @param userId - Acting user.
   * @returns The installed plugin.
   */
  async installStaged(token: string, userId: string): Promise<PluginSummary> {
    const staged = this.takeStaged(token);
    try {
      return await this.install(staged.dir, { source: 'file', userId, copy: true, verify: true });
    } finally {
      this.deps.store.remove(staged.dir);
    }
  }

  discardStaged(token: string): void {
    const staged = this.staged.get(token);
    this.staged.delete(token);
    if (staged) this.deps.store.remove(staged.dir);
  }

  /**
   * Loads (or reloads) an unpacked plugin folder in developer mode (SPEC 5.4 "Dev").
   *
   * @param dir - Plugin project folder.
   * @param userId - Acting user, or null for the dev socket.
   * @returns The plugin.
   */
  async loadUnpacked(dir: string, userId: string | null): Promise<PluginSummary> {
    const resolved = path.resolve(dir);
    const existing = [...this.loaded.entries()].find(([, p]) => p.installPath === resolved);
    if (existing) return this.reload(existing[0]);
    return this.install(resolved, { source: 'dev', userId, copy: false, verify: true });
  }

  /**
   * Restarts a plugin from its folder, re-reading the manifest.
   *
   * @param id - Plugin id.
   * @returns The plugin.
   */
  async reload(id: string): Promise<PluginSummary> {
    const row = this.requireRow(id);
    if (!row.installPath) throw new Error('The plugin is not installed');
    await this.unload(id);
    const manifest = readManifest(row.installPath);
    pluginRows.upsert(
      this.deps.db,
      { manifest, installSource: row.installSource, installPath: row.installPath, enabled: true },
      this.now(),
    );
    await this.load(id)?.handle.connect();
    this.changed();
    return this.summary(id);
  }

  async setEnabled(id: string, enabled: boolean, userId: string): Promise<void> {
    this.requireRow(id);
    pluginRows.update(this.deps.db, id, { enabled: enabled ? 1 : 0, updatedAt: this.now() });
    if (enabled) this.load(id);
    else await this.unload(id);
    if (enabled) this.enrichLibraryIfEnricher(id);
    this.audit(userId, enabled ? 'plugin.enable' : 'plugin.disable', id);
    this.changed();
  }

  /** Clears the crashed state ("Re-enable", SPEC 7.6). */
  reEnable(id: string, userId: string): void {
    this.loaded.get(id)?.handle.reset();
    pluginRows.update(this.deps.db, id, { health: 'ok', updatedAt: this.now() });
    this.audit(userId, 'plugin.reenable', id);
    this.changed();
  }

  /**
   * Uninstalls a plugin (SPEC 5.4): stops it, deletes its files, and either
   * removes the data it produced or keeps it with the plugin marked uninstalled.
   *
   * @param id - Plugin id.
   * @param removeData - Whether to delete its sources and private data.
   * @param userId - Acting user.
   */
  async uninstall(id: string, removeData: boolean, userId: string): Promise<void> {
    const row = this.requireRow(id);
    await this.unload(id);
    if (removeData) await this.removeData(id, userId);
    if (row.installSource !== 'dev') this.deps.store.pruneVersions(id, null);
    if (pluginRows.sourceCount(this.deps.db, id) > 0)
      pluginRows.update(this.deps.db, id, { installPath: null, enabled: 0 });
    else pluginRows.delete(this.deps.db, id);
    if (row.installSource === 'builtin')
      pluginRows.setRemovedDefaults(this.deps.db, [
        ...pluginRows.removedDefaults(this.deps.db),
        id,
      ]);
    this.audit(userId, 'plugin.uninstall', id, { removeData });
    this.changed();
  }

  /** Reinstalls every default plugin the user removed ("Restore default plugins"). */
  restoreDefaults(userId: string): void {
    pluginRows.setRemovedDefaults(this.deps.db, []);
    for (const { manifest, isNew } of this.installDefaults()) {
      this.load(manifest.id);
      if (isNew) this.enrichLibraryIfEnricher(manifest.id);
    }
    this.audit(userId, 'plugin.restore_defaults', null);
    this.changed();
  }

  /**
   * Last lines of a plugin's log file.
   *
   * @param id - Plugin id.
   * @param lines - Line count.
   * @returns The log tail, or an empty string.
   */
  logs(id: string, lines: number): string {
    try {
      const text = readFileSync(path.join(this.deps.logsDir, `plugin-${id}.log`), 'utf8');
      return text
        .split('\n')
        .slice(-lines - 1)
        .join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Host pid of a running plugin (tests, diagnostics).
   *
   * @param id - Plugin id.
   * @returns The pid or null.
   */
  hostPid(id: string): number | null {
    return this.loaded.get(id)?.handle.pid ?? null;
  }

  private async install(dir: string, options: InstallOptions): Promise<PluginSummary> {
    const manifest = readManifest(dir);
    const previous = pluginRows.get(this.deps.db, manifest.id);
    const installPath = await this.stageInstall(dir, manifest, options);
    try {
      await this.loadInstalled(manifest.id, options.verify);
    } catch (error) {
      await this.rollback(manifest.id, previous, installPath, options.copy);
      throw error;
    }
    this.cleanupPrevious(previous, installPath);
    if (!previous || !previous.installPath) this.enrichLibraryIfEnricher(manifest.id);
    this.audit(options.userId, 'plugin.install', manifest.id, {
      version: manifest.version,
      source: options.source,
    });
    this.changed();
    return this.summary(manifest.id);
  }

  private async stageInstall(
    dir: string,
    manifest: PluginManifest,
    options: InstallOptions,
  ): Promise<string> {
    await this.unload(manifest.id);
    const installPath = options.copy ? this.deps.store.installCopy(dir, manifest) : dir;
    pluginRows.upsert(
      this.deps.db,
      { manifest, installSource: options.source, installPath, enabled: true },
      this.now(),
    );
    return installPath;
  }

  private async loadInstalled(id: string, verify: boolean): Promise<void> {
    const loaded = this.load(id);
    if (verify) await loaded?.handle.connect();
    if (!loaded) throw new Error(this.errors.get(id) ?? 'Plugin failed to load');
  }

  private async rollback(
    id: string,
    previous: PluginRow | undefined,
    installPath: string,
    copied: boolean,
  ): Promise<void> {
    await this.unload(id);
    if (copied && installPath !== previous?.installPath) this.deps.store.remove(installPath);
    if (!previous) return pluginRows.delete(this.deps.db, id);
    pluginRows.restore(this.deps.db, previous);
    if (previous.enabled && previous.installPath) this.load(id);
  }

  private cleanupPrevious(previous: PluginRow | undefined, installPath: string): void {
    const old = previous?.installPath;
    if (old && old !== installPath && previous.installSource !== 'dev') this.deps.store.remove(old);
  }

  /**
   * Queues an enricher for every asset ("Re-run on library", SPEC 6.3).
   *
   * @param id - Plugin id.
   * @param userId - Acting user.
   */
  rerunOnLibrary(id: string, userId: string): void {
    if (!this.deps.enrichers.get(id)) throw new Error('Only enabled enrichers can be re-run');
    this.deps.enrichLibrary(id);
    this.audit(userId, 'plugin.rerun', id);
  }

  private enrichLibraryIfEnricher(id: string): void {
    if (this.deps.enrichers.get(id)) this.deps.enrichLibrary(id);
  }

  private installDefaults(): (BundledPlugin & { isNew: boolean })[] {
    const removed = new Set(pluginRows.removedDefaults(this.deps.db));
    const installed: (BundledPlugin & { isNew: boolean })[] = [];
    for (const bundled of this.bundled()) {
      if (removed.has(bundled.manifest.id) || !this.needsDefaultInstall(bundled)) continue;
      const row = pluginRows.get(this.deps.db, bundled.manifest.id);
      const installPath = this.deps.store.installCopy(bundled.dir, bundled.manifest);
      const enabled = row
        ? row.enabled === 1
        : (bundled.manifest.default?.enabledOnInstall ?? true);
      pluginRows.upsert(
        this.deps.db,
        { manifest: bundled.manifest, installSource: 'builtin', installPath, enabled },
        this.now(),
      );
      this.deps.store.pruneVersions(bundled.manifest.id, installPath);
      installed.push({ ...bundled, isNew: !row });
    }
    return installed;
  }

  private needsDefaultInstall({ manifest }: BundledPlugin): boolean {
    const row = pluginRows.get(this.deps.db, manifest.id);
    if (!row) return true;
    if (row.installSource !== 'builtin') return false;
    return !row.installPath || compareVersions(manifest.version, row.version) > 0;
  }

  private load(id: string): LoadedPlugin | undefined {
    const row = this.requireRow(id);
    this.errors.delete(id);
    try {
      const loaded = loadPlugin(
        this.loaderDeps(),
        readManifest(row.installPath!),
        row.installPath!,
      );
      if (loaded.enricher) this.deps.enrichers.add(loaded.enricher);
      this.loaded.set(id, loaded);
      if (loaded.entry) this.deps.registry.add(loaded.entry);
      return loaded;
    } catch (error) {
      this.errors.set(id, (error as Error).message);
      this.deps.logger.warn({ err: error, pluginId: id }, 'Plugin failed to load');
      return undefined;
    }
  }

  private async unload(id: string): Promise<void> {
    const loaded = this.loaded.get(id);
    this.loaded.delete(id);
    this.deps.registry.remove(id);
    this.deps.enrichers.remove(id);
    this.deps.watches.unsubscribePlugin(id);
    await loaded?.handle.stop();
  }

  private async removeData(id: string, userId: string): Promise<void> {
    await this.deps.removeSources(id, userId);
    this.deps.db.delete(schema.pluginKv).where(eq(schema.pluginKv.pluginId, id)).run();
    this.deps.store.removeData(id);
  }

  private loaderDeps(): LoaderDeps {
    return {
      ...this.deps.loader,
      store: this.deps.store,
      onStarted: (id) => void this.deps.watches.refreshPlugin(id).catch(() => undefined),
      onCrashed: (id, delay) => this.onCrashed(id, delay),
    };
  }

  private onCrashed(id: string, restartInMs: number | null): void {
    if (restartInMs === null)
      pluginRows.update(this.deps.db, id, { health: 'crashed', updatedAt: this.now() });
    this.deps.watches.hostLost(id, restartInMs);
    this.changed();
  }

  private async sweepIdle(): Promise<void> {
    for (const plugin of this.loaded.values()) await plugin.handle.stopIfIdle().catch(() => false);
  }

  private takeStaged(token: string): StagedPackage {
    const staged = this.staged.get(token);
    if (!staged) throw new Error('This package is no longer staged; choose the file again');
    this.staged.delete(token);
    return staged;
  }

  private summaryOf(row: PluginRow, isDefault: boolean): PluginSummary {
    const sourceCount = pluginRows.sourceCount(this.deps.db, row.id);
    return pluginSummary({
      row,
      loaded: this.loaded.get(row.id),
      error: this.errors.get(row.id),
      isDefault,
      queueSize: this.deps.queueSize(row.id),
      sourceCount,
    });
  }

  private bundled(): BundledPlugin[] {
    return bundledPlugins(this.deps.defaultsDir);
  }

  private requireRow(id: string): PluginRow {
    const row = pluginRows.get(this.deps.db, id);
    if (!row) throw new Error(`Plugin not installed: ${id}`);
    return row;
  }

  private audit(userId: string | null, action: string, id: string | null, details?: unknown): void {
    writeAudit(
      this.deps.db,
      { userId, action, targetType: 'plugin', targetId: id ?? undefined, details },
      this.now(),
    );
  }

  private changed(): void {
    this.deps.events.emit('plugins.changed', {});
    this.deps.events.emit('sources.changed', {});
  }

  private now(): number {
    return (this.deps.clock ?? systemClock)();
  }
}
