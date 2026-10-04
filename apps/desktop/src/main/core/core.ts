import { settingsSchemaOf, type PluginManifest } from '@photobeaver/shared/manifest';
import { OAuthBroker } from './oauth/oauth-broker';
import { SecretsService, type SecretCipher } from './secrets/secrets-service';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { schema, type OpenLibrary } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { systemClock, type Clock } from './clock';
import { createPluginStorage } from './connectors/plugin-storage';
import { ConnectorRegistry, type ConnectorEntry, type CoreLog } from './connectors/registry';
import type { EventSink } from './events/event-sink';
import { JobQueue } from './jobs/job-queue';
import { Lane } from './jobs/lane';
import { Maintenance } from './maintenance';
import { OriginalCache } from './originals/original-cache';
import { OriginalSource } from './originals/original-source';
import { CallContexts } from './plugins/call-contexts';
import type { HostLauncher } from './plugins/host-launcher';
import { PluginManager } from './plugins/plugin-manager';
import { PluginStore } from './plugins/plugin-store';
import { WatchManager } from './plugins/watch-manager';
import { Scheduler } from './scheduler/scheduler';
import { SourceService } from './sources/source-service';
import { BatchWriter } from './sync/batch-writer';
import { SyncRunner } from './sync/sync-runner';
import { ThumbnailService } from './thumbnails/thumbnail-service';
import { DuplicatesService } from './enrich/duplicates-service';
import { EnrichmentSystem } from './enrich/enrichment-system';
import type { EnricherEntry } from './enrich/types';

export const SYNC_LANE_CONCURRENCY = 3;

export interface PluginSystemOptions {
  launcher: HostLauncher;
  pluginsDir: string;
  tempDir: string;
  defaultsDir: string;
  logsDir: string;
  pluginLog(pluginId: string): { log: CoreLog; file: string };
}

export interface CoreOptions {
  library: OpenLibrary;
  libraryDir: string;
  pluginDataRoot: string;
  connectors?: ConnectorEntry[];
  plugins?: PluginSystemOptions;
  events: EventSink;
  logger: CoreLog;
  ffmpegPath: string;
  pickDirectory: () => Promise<string | null>;
  clock?: Clock;
  syncBatchDelayMs?: number;
  enrichers?: EnricherEntry[];
  isOnBattery?: () => boolean;
  secretCipher?: SecretCipher;
  openExternal?: (url: string) => Promise<void>;
  fetch?: typeof fetch;
}

const notConfigured = (feature: string) => (): never => {
  throw new Error(`${feature} is not configured`);
};

const NO_SECRET_STORAGE: SecretCipher = {
  encrypt: notConfigured('Secret storage'),
  decrypt: notConfigured('Secret storage'),
};

const NO_BROWSER = async (): Promise<never> => notConfigured('Opening links')();

/**
 * Composition root of the core services (no Electron imports, so it runs headless
 * in tests). Owns the queue, lanes, scheduler, plugin system and maintenance.
 */
export class Core {
  readonly queue: JobQueue;
  readonly registry: ConnectorRegistry;
  readonly scheduler: Scheduler;
  readonly writer: BatchWriter;
  readonly originals: OriginalCache;
  readonly thumbnails: ThumbnailService;
  readonly watches: WatchManager;
  readonly sources: SourceService;
  readonly plugins: PluginManager | null;
  readonly enrichment: EnrichmentSystem;
  readonly secrets: SecretsService;
  readonly oauth: OAuthBroker;
  readonly duplicates: DuplicatesService;
  private readonly syncLane: Lane;
  private readonly lanes: Lane[];
  private readonly maintenance: Maintenance;
  private readonly clock: Clock;

  constructor(private readonly options: CoreOptions) {
    this.clock = options.clock ?? systemClock;
    this.queue = new JobQueue(options.library.sqlite, this.clock);
    this.secrets = new SecretsService(
      options.library.db,
      options.secretCipher ?? NO_SECRET_STORAGE,
    );
    this.oauth = new OAuthBroker({ openExternal: this.openExternal, fetch: options.fetch });
    this.registry = this.createRegistry();
    this.scheduler = new Scheduler(options.library.db, this.queue, this.clock);
    const source = new OriginalSource(options.library.db, this.registry);
    this.originals = new OriginalCache(path.join(options.libraryDir, 'cache', 'originals'), source);
    this.enrichment = this.createEnrichment();
    this.duplicates = new DuplicatesService(
      options.library.db,
      this.enrichment.merges,
      options.events,
      this.clock,
    );
    this.writer = new BatchWriter(options.library.db, this.queue, (ids) =>
      this.enrichment.scheduler.contentChanged(ids),
    );
    this.thumbnails = this.createThumbnails(source);
    this.syncLane = this.createSyncLane();
    this.lanes = [this.syncLane, this.createCoreLane(), ...this.enrichment.lanes];
    this.watches = this.createWatches();
    this.sources = this.createSources();
    this.maintenance = this.createMaintenance();
    this.plugins = options.plugins ? this.createPlugins(options.plugins) : null;
  }

  /** Loads plugins, recovers crashed work and starts background processing. */
  start(): void {
    this.registry.registerBuiltins(this.clock());
    this.plugins?.start();
    const recovered = this.queue.recoverLeases({ allOwners: true });
    this.scheduler.reconcile();
    this.queue.onEnqueue(() => this.lanes.forEach((lane) => lane.wake()));
    this.lanes.forEach((lane) => lane.start());
    this.scheduler.start();
    this.maintenance.start();
    void this.startWatches();
    this.options.logger.info({ recovered }, 'Core started');
  }

  /** Stops leasing, gives in-flight jobs 5 seconds, then stops plugin hosts (SPEC 7.7). */
  async stop(): Promise<void> {
    this.scheduler.stop();
    this.maintenance.stop();
    await Promise.all(this.lanes.map((lane) => lane.stop()));
    this.watches.stopAll();
    await this.plugins?.stop();
  }

  private async startWatches(): Promise<void> {
    const rows = this.options.library.db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .all();
    for (const { id } of rows) await this.watches.refresh(id).catch(() => undefined);
  }

  private createRegistry(): ConnectorRegistry {
    const { db } = this.options.library;
    const { pluginDataRoot, logger, pickDirectory, fetch } = this.options;
    return new ConnectorRegistry(this.options.connectors ?? [], {
      db,
      pluginDataRoot,
      logger,
      pickDirectory,
      fetch,
      secrets: this.secrets,
      oauth: this.oauth,
      openExternal: this.openExternal,
      settings: (manifest) =>
        this.enrichment.settings.get(manifest.id, settingsSchemaOf(manifest) ?? {}),
    });
  }

  private get openExternal(): (url: string) => Promise<void> {
    return this.options.openExternal ?? NO_BROWSER;
  }

  private createThumbnails(source: OriginalSource): ThumbnailService {
    return new ThumbnailService({
      db: this.options.library.db,
      thumbsDir: path.join(this.options.libraryDir, 'thumbs'),
      source,
      cache: this.originals,
      ffmpegPath: this.options.ffmpegPath,
      logger: this.options.logger,
      onReady: (update) => {
        this.options.events.emit('thumbs.ready', { items: [update] });
        this.enrichment.scheduler.thumbnailReady(update.id);
      },
      clock: this.clock,
    });
  }

  private createSyncLane(): Lane {
    const { events, logger, syncBatchDelayMs } = this.options;
    const deps = {
      db: this.options.library.db,
      writer: this.writer,
      registry: this.registry,
      events,
      logger,
    };
    const runner = new SyncRunner({ ...deps, clock: this.clock, batchDelayMs: syncBatchDelayMs });
    const handlers = { sync_source: runner.run };
    return new Lane(
      this.queue,
      { name: 'sync', concurrency: SYNC_LANE_CONCURRENCY, handlers },
      logger,
    );
  }

  private createCoreLane(): Lane {
    const concurrency = Math.max(1, availableParallelism() - 1);
    const handlers = { thumbnail: this.thumbnails.run };
    return new Lane(this.queue, { name: 'core', concurrency, handlers }, this.options.logger);
  }

  private createWatches(): WatchManager {
    const { events, logger } = this.options;
    return new WatchManager({
      db: this.options.library.db,
      registry: this.registry,
      writer: this.writer,
      events,
      logger,
      clock: this.clock,
    });
  }

  private createSources(): SourceService {
    return new SourceService({
      db: this.options.library.db,
      registry: this.registry,
      queue: this.queue,
      scheduler: this.scheduler,
      events: this.options.events,
      removeAssetFiles: (ids) => this.removeAssetFiles(ids),
      secrets: this.secrets,
      pluginDataRoot: this.options.pluginDataRoot,
      clock: this.clock,
      abortSync: (id) => this.syncLane.abortWhere((job) => job.source_id === id),
      onSourceChanged: (id) => void this.watches.refresh(id).catch(() => undefined),
    });
  }

  private createMaintenance(): Maintenance {
    const { db } = this.options.library;
    const removeAssetFiles = (ids: string[]) => this.removeAssetFiles(ids);
    return new Maintenance({
      db,
      queue: this.queue,
      logger: this.options.logger,
      removeAssetFiles,
      clock: this.clock,
    });
  }

  private createPlugins(plugins: PluginSystemOptions): PluginManager {
    const removeSources = (pluginId: string, userId: string) =>
      this.removeSourcesOf(pluginId, userId);
    const { events, logger } = this.options;
    return new PluginManager({
      db: this.options.library.db,
      store: this.createPluginStore(plugins),
      registry: this.registry,
      watches: this.watches,
      events,
      logger,
      loader: this.createPluginLoader(plugins),
      defaultsDir: plugins.defaultsDir,
      logsDir: plugins.logsDir,
      removeSources,
      enrichers: this.enrichment.registry,
      enrichLibrary: (id) => void this.enrichment.scheduler.queueLibrary(id),
      queueSize: (id) => this.queue.pendingFor('enrich', id),
      settings: this.enrichment.settings,
      clock: this.clock,
    });
  }

  private createEnrichment(): EnrichmentSystem {
    const { library, libraryDir, events, logger } = this.options;
    const system = new EnrichmentSystem({
      db: library.db,
      queue: this.queue,
      connectors: this.registry,
      originals: this.originals,
      thumbsDir: path.join(libraryDir, 'thumbs'),
      tempDir: path.join(libraryDir, 'cache'),
      events,
      logger,
      clock: this.clock,
      isOnBattery: this.options.isOnBattery ?? (() => false),
    });
    system.addAll(this.options.enrichers ?? []);
    return system;
  }

  private createPluginStore(plugins: PluginSystemOptions): PluginStore {
    return new PluginStore({
      pluginsDir: plugins.pluginsDir,
      pluginDataDir: this.options.pluginDataRoot,
      tempDir: plugins.tempDir,
    });
  }

  private createPluginLoader(plugins: PluginSystemOptions) {
    const { db } = this.options.library;
    return {
      launcher: plugins.launcher,
      contexts: new CallContexts(),
      logger: this.options.logger,
      pluginLog: plugins.pluginLog,
      storage: (id: string) => createPluginStorage(db, id),
      settings: (manifest: PluginManifest) =>
        this.enrichment.settings.get(manifest.id, settingsSchemaOf(manifest) ?? {}),
      clock: this.clock,
    };
  }

  private async removeSourcesOf(pluginId: string, userId: string): Promise<void> {
    const rows = this.options.library.db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(eq(schema.sources.pluginId, pluginId))
      .all();
    for (const { id } of rows) await this.sources.remove(id, userId);
  }

  private async removeAssetFiles(assetIds: string[]): Promise<void> {
    for (const id of assetIds) {
      await this.thumbnails.remove(id);
      await this.originals.evict(id);
    }
  }
}
