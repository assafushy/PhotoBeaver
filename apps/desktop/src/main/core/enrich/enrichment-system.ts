import { availableParallelism } from 'node:os';
import path from 'node:path';
import type { LibraryDb } from '@photobeaver/db';
import type { Clock } from '../clock';
import type { ConnectorRegistry, CoreLog } from '../connectors/registry';
import type { EventSink } from '../events/event-sink';
import type { JobQueue } from '../jobs/job-queue';
import type { JobRow } from '../jobs/job-types';
import { Lane } from '../jobs/lane';
import type { OriginalCache } from '../originals/original-cache';
import type { EnrichContextDeps } from './enrich-context';
import { EnrichRunner } from './enrich-runner';
import { EnrichScheduler } from './enrich-scheduler';
import { EnricherRegistry } from './enricher-registry';
import { Finalizer } from './finalizer';
import { InputProvider } from './input-provider';
import { MergeService } from './merge-service';
import { PluginSettings } from './plugin-settings';
import type { EnricherEntry } from './types';

type ResourceClass = EnricherEntry['manifest']['enricher']['resourceClass'];

export interface EnrichmentDeps {
  db: LibraryDb;
  queue: JobQueue;
  connectors: ConnectorRegistry;
  originals: OriginalCache;
  thumbsDir: string;
  tempDir: string;
  events: EventSink;
  logger: CoreLog;
  clock: Clock;
  isOnBattery: () => boolean;
}

const LANE_SIZES: Record<ResourceClass, () => number> = {
  light: () => 4,
  'cpu-heavy': () => Math.max(1, Math.floor(availableParallelism() / 2)),
  gpu: () => 1,
};

/**
 * Composition of the enrichment pipeline (SPEC 7.5): registry, scheduler,
 * runner, finalizer, merges and one lane per resource class.
 */
export class EnrichmentSystem {
  readonly registry = new EnricherRegistry();
  readonly settings: PluginSettings;
  readonly scheduler: EnrichScheduler;
  readonly merges: MergeService;
  readonly lanes: Lane[];

  constructor(private readonly deps: EnrichmentDeps) {
    this.settings = new PluginSettings(deps.db);
    this.scheduler = new EnrichScheduler(deps.db, deps.queue, this.registry, deps.clock);
    this.merges = new MergeService(deps.db, this.scheduler, deps.events, deps.clock);
    const runner = this.createRunner();
    this.lanes = (Object.keys(LANE_SIZES) as ResourceClass[]).map((cls) =>
      this.createLane(cls, runner),
    );
  }

  /**
   * Adds in-process enrichers (tests and headless runs).
   *
   * @param entries - Enrichers.
   */
  addAll(entries: readonly EnricherEntry[]): void {
    entries.forEach((entry) => this.registry.add(entry));
  }

  private createRunner(): EnrichRunner {
    const { db, queue, events, logger, clock } = this.deps;
    return new EnrichRunner({
      db,
      queue,
      registry: this.registry,
      scheduler: this.scheduler,
      merges: this.merges,
      finalizer: new Finalizer(queue, clock),
      context: this.createContext(),
      events,
      logger,
      clock,
    });
  }

  private createContext(): EnrichContextDeps {
    const { db, thumbsDir, originals, tempDir, connectors, clock } = this.deps;
    const inputs = new InputProvider(db, thumbsDir, originals, path.join(tempDir, 'enrich'));
    return { db, registry: connectors, inputs, settings: this.settings, now: clock };
  }

  private createLane(resourceClass: ResourceClass, runner: EnrichRunner): Lane {
    const handlers = { enrich: runner.run, plugin_task: runner.run };
    const leaseFilter = (inFlight: readonly JobRow[]) => this.leaseFilter(resourceClass, inFlight);
    return new Lane(
      this.deps.queue,
      {
        name: `enrich-${resourceClass}`,
        concurrency: LANE_SIZES[resourceClass](),
        handlers,
        leaseFilter,
      },
      this.deps.logger,
    );
  }

  private leaseFilter(resourceClass: ResourceClass, inFlight: readonly JobRow[]) {
    if (resourceClass !== 'light' && this.deps.isOnBattery()) return null;
    const pluginIds = this.registry.idsOfClass(resourceClass);
    const busy = pluginIds.filter(
      (id) =>
        inFlight.filter((job) => job.plugin_id === id).length >=
        (this.registry.get(id)?.manifest.enricher.concurrency ?? 1),
    );
    return { pluginIds, excludePluginIds: busy };
  }
}
