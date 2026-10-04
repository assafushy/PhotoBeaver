import { schema, type LibraryDb } from '@photobeaver/db';
import { validateConfig, type ConnectorInfo, type SourceSummary } from '@photobeaver/shared';
import { count, eq, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import { writeAudit } from '../audit';
import { deleteOrphanAssets } from '../assets/purge';
import { systemClock, type Clock } from '../clock';
import type { ConnectorRegistry } from '../connectors/registry';
import type { EventSink } from '../events/event-sink';
import type { JobQueue } from '../jobs/job-queue';
import type { Scheduler } from '../scheduler/scheduler';
import { parseSchedule, type Schedule } from '../scheduler/schedule';

const { sources, instances } = schema;

export interface SourceServiceDeps {
  db: LibraryDb;
  registry: ConnectorRegistry;
  queue: JobQueue;
  scheduler: Scheduler;
  events: EventSink;
  abortSync: (sourceId: string) => void;
  removeAssetFiles: (assetIds: string[]) => Promise<void>;
  onSourceChanged?: (sourceId: string) => void;
  clock?: Clock;
}

type SourceRow = typeof sources.$inferSelect;

function displayLocation(configJson: string): string | null {
  const root = (JSON.parse(configJson) as { root?: unknown }).root;
  return typeof root === 'string' ? root : null;
}

export const WATCH_SAFETY_INTERVAL_SEC = 24 * 60 * 60;

interface NewSource {
  id: string;
  pluginId: string;
  displayName: string;
  config: Record<string, unknown>;
  schedule: Schedule;
}

/**
 * Initial schedule for a new source: watch mode with a daily safety full scan
 * when the connector can watch (SPEC 7.2, 9.2), otherwise polling at its default interval.
 *
 * @param connector - Manifest connector section.
 * @returns The schedule.
 */
export function initialSchedule(connector: {
  syncModes: string[];
  defaultIntervalSec: number;
}): Schedule {
  if (connector.syncModes.includes('watch'))
    return { mode: 'watch', intervalSec: WATCH_SAFETY_INTERVAL_SEC };
  return { mode: 'poll', intervalSec: connector.defaultIntervalSec };
}

function validationMessage(errors: Record<string, string>): string {
  return `Invalid configuration: ${Object.entries(errors)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')}`;
}

function sourceRowValues(source: NewSource, now: number) {
  return {
    id: source.id,
    pluginId: source.pluginId,
    displayName: source.displayName,
    configJson: JSON.stringify(source.config),
    scheduleJson: JSON.stringify(source.schedule),
    nextRunAt: now,
    createdAt: now,
  };
}

function assetIdsOfSource(db: LibraryDb, sourceId: string): string[] {
  return db
    .selectDistinct({ id: instances.assetId })
    .from(instances)
    .where(eq(instances.sourceId, sourceId))
    .all()
    .map((r) => r.id);
}

/**
 * Adds, lists, pauses, resumes, syncs and removes sources (SPEC 8.1 Sources).
 */
export class SourceService {
  private readonly clock: Clock;

  constructor(private readonly deps: SourceServiceDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Installed connectors that can be added as sources.
   *
   * @returns Connector id, name, description and config schema.
   */
  connectors(): ConnectorInfo[] {
    return this.deps.registry.list().map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description ?? '',
      configSchema: manifest.configSchema ?? {},
    }));
  }

  /**
   * All sources with live item counts.
   *
   * @returns Source summaries ordered by creation.
   */
  list(): SourceSummary[] {
    const counts = this.itemCounts();
    return this.deps.db
      .select()
      .from(sources)
      .orderBy(sources.createdAt)
      .all()
      .map((row) => this.summarize(row, counts.get(row.id) ?? 0));
  }

  /**
   * Validates config, runs the connector's setup and queues the first sync.
   *
   * @param input - Connector id and user config.
   * @param userId - Acting user, for the audit log.
   * @returns The new source.
   */
  async add(
    input: { pluginId: string; config: Record<string, unknown> },
    userId: string,
  ): Promise<SourceSummary> {
    const { entry, config } = this.validated(input);
    const id = ulid(this.clock());
    const ctx = this.deps.registry.sourceContext(
      { id, pluginId: input.pluginId, config },
      new AbortController().signal,
    );
    const setup = await entry.plugin.setupSource(ctx);
    const schedule = initialSchedule(entry.manifest.connector);
    this.insert(
      { id, pluginId: input.pluginId, displayName: setup.displayName, config, schedule },
      userId,
    );
    this.deps.scheduler.syncNow(id, input.pluginId);
    this.changedSource(id);
    return this.summary(id);
  }

  /**
   * Removes a source, its instances and any assets left without instances.
   *
   * @param sourceId - Source id.
   * @param userId - Acting user, for the audit log.
   */
  async remove(sourceId: string, userId: string): Promise<void> {
    const source = this.require(sourceId);
    this.deps.abortSync(sourceId);
    const removed = this.deps.db.transaction((txRaw) =>
      this.deleteSource(txRaw as unknown as LibraryDb, source, userId),
    );
    await this.deps.removeAssetFiles(removed);
    this.deps.onSourceChanged?.(sourceId);
    this.emitChanged();
  }

  /**
   * Pauses scheduled syncs and stops a running one.
   *
   * @param sourceId - Source id.
   */
  pause(sourceId: string): void {
    this.require(sourceId);
    this.deps.db.update(sources).set({ syncState: 'paused' }).where(eq(sources.id, sourceId)).run();
    this.deps.abortSync(sourceId);
    this.changedSource(sourceId);
  }

  /**
   * Resumes a paused source and syncs it now.
   *
   * @param sourceId - Source id.
   */
  resume(sourceId: string): void {
    const source = this.require(sourceId);
    this.deps.db
      .update(sources)
      .set({ syncState: 'idle', nextRunAt: this.clock() })
      .where(eq(sources.id, sourceId))
      .run();
    this.deps.scheduler.syncNow(sourceId, source.pluginId);
    this.changedSource(sourceId);
  }

  /**
   * Queues a sync at UI priority.
   *
   * @param sourceId - Source id.
   * @throws Error when the source is paused.
   */
  syncNow(sourceId: string): void {
    const source = this.require(sourceId);
    if (source.syncState === 'paused') throw new Error('Resume the source before syncing it');
    this.deps.scheduler.syncNow(sourceId, source.pluginId);
    this.deps.events.emit('sources.changed', {});
  }

  private validated(input: { pluginId: string; config: Record<string, unknown> }) {
    const entry = this.deps.registry.get(input.pluginId);
    if (!entry) throw new Error(`Connector not installed: ${input.pluginId}`);
    const validation = validateConfig(entry.manifest.configSchema ?? {}, input.config);
    if (!validation.ok) throw new Error(validationMessage(validation.errors));
    return { entry, config: validation.value };
  }

  private deleteSource(tx: LibraryDb, source: SourceRow, userId: string): string[] {
    const candidates = assetIdsOfSource(tx, source.id);
    this.deps.queue.deleteQueued('source_id', source.id);
    tx.delete(sources).where(eq(sources.id, source.id)).run();
    writeAudit(
      tx,
      {
        userId,
        action: 'source.remove',
        targetType: 'source',
        targetId: source.id,
        details: { name: source.displayName },
      },
      this.clock(),
    );
    return deleteOrphanAssets(tx, candidates);
  }

  private insert(source: NewSource, userId: string): void {
    const now = this.clock();
    const { id, pluginId, displayName } = source;
    this.deps.db.transaction((txRaw) => {
      const tx = txRaw as unknown as LibraryDb;
      tx.insert(sources).values(sourceRowValues(source, now)).run();
      writeAudit(
        tx,
        {
          userId,
          action: 'source.add',
          targetType: 'source',
          targetId: id,
          details: { pluginId, displayName },
        },
        now,
      );
    });
  }

  private changedSource(sourceId: string): void {
    this.deps.onSourceChanged?.(sourceId);
    this.deps.events.emit('sources.changed', {});
  }

  private emitChanged(): void {
    this.deps.events.emit('sources.changed', {});
    this.deps.events.emit('library.changed', {});
  }

  private require(sourceId: string): SourceRow {
    const row = this.deps.db.select().from(sources).where(eq(sources.id, sourceId)).get();
    if (!row) throw new Error(`Source not found: ${sourceId}`);
    return row;
  }

  private summary(sourceId: string): SourceSummary {
    return this.list().find((s) => s.id === sourceId)!;
  }

  private itemCounts(): Map<string, number> {
    const rows = this.deps.db
      .select({ sourceId: instances.sourceId, n: count() })
      .from(instances)
      .where(isNull(instances.deletedAt))
      .groupBy(instances.sourceId)
      .all();
    return new Map(rows.map((r) => [r.sourceId, r.n]));
  }

  private summarize(row: SourceRow, itemCount: number): SourceSummary {
    const connector = this.deps.registry.get(row.pluginId);
    return {
      id: row.id,
      pluginId: row.pluginId,
      connectorName: connector?.manifest.name ?? row.pluginId,
      connectorAvailable: connector !== undefined,
      displayName: row.displayName,
      location: displayLocation(row.configJson),
      syncState: row.syncState,
      itemCount,
      lastSyncFinishedAt: row.lastSyncFinishedAt,
      lastError: row.lastError,
      nextRunAt: row.nextRunAt,
      intervalSec: parseSchedule(row.scheduleJson).intervalSec,
    };
  }
}
