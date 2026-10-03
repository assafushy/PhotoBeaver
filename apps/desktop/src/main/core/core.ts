import { availableParallelism } from 'node:os';
import path from 'node:path';
import type { OpenLibrary } from '@photobeaver/db';
import { systemClock, type Clock } from './clock';
import { ConnectorRegistry, type ConnectorEntry, type CoreLog } from './connectors/registry';
import type { EventSink } from './events/event-sink';
import { JobQueue } from './jobs/job-queue';
import { Lane } from './jobs/lane';
import { Maintenance } from './maintenance';
import { OriginalCache } from './originals/original-cache';
import { OriginalSource } from './originals/original-source';
import { Scheduler } from './scheduler/scheduler';
import { SourceService } from './sources/source-service';
import { BatchWriter } from './sync/batch-writer';
import { SyncRunner } from './sync/sync-runner';
import { ThumbnailService } from './thumbnails/thumbnail-service';

export const SYNC_LANE_CONCURRENCY = 3;

export interface CoreOptions {
  library: OpenLibrary;
  libraryDir: string;
  pluginDataRoot: string;
  connectors: ConnectorEntry[];
  events: EventSink;
  logger: CoreLog;
  ffmpegPath: string;
  pickDirectory: () => Promise<string | null>;
  clock?: Clock;
  syncBatchDelayMs?: number;
}

/**
 * Composition root of the core services (no Electron imports, so it runs headless
 * in tests). Owns the queue, lanes, scheduler and maintenance lifecycle.
 */
export class Core {
  readonly queue: JobQueue;
  readonly registry: ConnectorRegistry;
  readonly scheduler: Scheduler;
  readonly sources: SourceService;
  readonly originals: OriginalCache;
  readonly thumbnails: ThumbnailService;
  private readonly lanes: Lane[];
  private readonly maintenance: Maintenance;

  constructor(private readonly options: CoreOptions) {
    const { db, sqlite } = options.library;
    const clock = options.clock ?? systemClock;
    this.queue = new JobQueue(sqlite, clock);
    this.registry = new ConnectorRegistry(options.connectors, {
      db,
      pluginDataRoot: options.pluginDataRoot,
      logger: options.logger,
      pickDirectory: options.pickDirectory,
    });
    this.scheduler = new Scheduler(db, this.queue, clock);
    const source = new OriginalSource(db, this.registry);
    this.originals = new OriginalCache(path.join(options.libraryDir, 'cache', 'originals'), source);
    this.thumbnails = this.createThumbnails(source, clock);
    const syncLane = this.createSyncLane(clock);
    this.lanes = [syncLane, this.createCoreLane()];
    const removeAssetFiles = (ids: string[]) => this.removeAssetFiles(ids);
    this.sources = new SourceService({
      db,
      registry: this.registry,
      queue: this.queue,
      scheduler: this.scheduler,
      events: options.events,
      removeAssetFiles,
      clock,
      abortSync: (id) => syncLane.abortWhere((job) => job.source_id === id),
    });
    this.maintenance = new Maintenance({
      db,
      queue: this.queue,
      logger: options.logger,
      removeAssetFiles,
      clock,
    });
  }

  /** Registers builtin plugins, recovers crashed work and starts background processing. */
  start(): void {
    this.registry.registerBuiltins((this.options.clock ?? systemClock)());
    const recovered = this.queue.recoverLeases({ allOwners: true });
    this.scheduler.reconcile();
    this.queue.onEnqueue(() => this.lanes.forEach((lane) => lane.wake()));
    this.lanes.forEach((lane) => lane.start());
    this.scheduler.start();
    this.maintenance.start();
    this.options.logger.info({ recovered }, 'Core started');
  }

  /** Stops leasing, gives in-flight jobs 5 seconds, then stops (SPEC 7.7 "Quit"). */
  async stop(): Promise<void> {
    this.scheduler.stop();
    this.maintenance.stop();
    await Promise.all(this.lanes.map((lane) => lane.stop()));
  }

  private createThumbnails(source: OriginalSource, clock: Clock): ThumbnailService {
    return new ThumbnailService({
      db: this.options.library.db,
      thumbsDir: path.join(this.options.libraryDir, 'thumbs'),
      source,
      cache: this.originals,
      ffmpegPath: this.options.ffmpegPath,
      logger: this.options.logger,
      onReady: (update) => this.options.events.emit('thumbs.ready', { items: [update] }),
      clock,
    });
  }

  private createSyncLane(clock: Clock): Lane {
    const { db } = this.options.library;
    const runner = new SyncRunner({
      db,
      writer: new BatchWriter(db, this.queue),
      registry: this.registry,
      events: this.options.events,
      logger: this.options.logger,
      clock,
      batchDelayMs: this.options.syncBatchDelayMs,
    });
    return new Lane(
      this.queue,
      { name: 'sync', concurrency: SYNC_LANE_CONCURRENCY, handlers: { sync_source: runner.run } },
      this.options.logger,
    );
  }

  private createCoreLane(): Lane {
    const concurrency = Math.max(1, availableParallelism() - 1);
    return new Lane(
      this.queue,
      { name: 'core', concurrency, handlers: { thumbnail: this.thumbnails.run } },
      this.options.logger,
    );
  }

  private async removeAssetFiles(assetIds: string[]): Promise<void> {
    for (const id of assetIds) {
      await this.thumbnails.remove(id);
      await this.originals.evict(id);
    }
  }
}
