import { schema, type LibraryDb } from '@photobeaver/db';
import type { Unsubscribe } from '@photobeaver/plugin-sdk';
import { and, eq, ne } from 'drizzle-orm';
import { systemClock, type Clock } from '../clock';
import type { ConnectorRegistry, CoreLog } from '../connectors/registry';
import type { EventSink } from '../events/event-sink';
import { parseSchedule } from '../scheduler/schedule';
import type { BatchWriter } from '../sync/batch-writer';
import { validateBatch } from '../sync/media-item-schema';

type SourceRow = typeof schema.sources.$inferSelect;

export const WATCH_RUN_ID = 'watch';

export interface WatchManagerDeps {
  db: LibraryDb;
  registry: ConnectorRegistry;
  writer: BatchWriter;
  events: EventSink;
  logger: CoreLog;
  clock?: Clock;
}

/**
 * Keeps `watch()` subscriptions for watch-mode sources (SPEC 7.2 step 3) and
 * writes their batches without moving the sync cursor. Subscriptions are
 * re-created when a plugin host restarts.
 */
export class WatchManager {
  private readonly active = new Map<string, { pluginId: string; stop: Unsubscribe }>();
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: WatchManagerDeps) {}

  /**
   * Brings one source in line with its state: subscribed when it is a
   * watch-mode source that is not paused, unsubscribed otherwise.
   *
   * @param sourceId - Source id.
   */
  async refresh(sourceId: string): Promise<void> {
    const source = this.load(sourceId);
    if (!source || !this.shouldWatch(source)) return this.unsubscribe(sourceId);
    if (!this.active.has(sourceId)) await this.subscribe(source);
  }

  /**
   * Subscribes every eligible source of a plugin (after its host starts).
   *
   * @param pluginId - Plugin id.
   */
  async refreshPlugin(pluginId: string): Promise<void> {
    const rows = this.deps.db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.pluginId, pluginId), ne(schema.sources.syncState, 'paused')))
      .all();
    await Promise.all(rows.map((row) => this.refresh(row.id)));
  }

  /**
   * Forgets subscriptions of a plugin whose host stopped, and resubscribes later.
   *
   * @param pluginId - Plugin id.
   * @param retryInMs - Delay before resubscribing, or null to stay stopped.
   */
  hostLost(pluginId: string, retryInMs: number | null): void {
    for (const [sourceId, sub] of this.active)
      if (sub.pluginId === pluginId) this.active.delete(sourceId);
    if (retryInMs === null || this.pendingTimers.has(pluginId)) return;
    const timer = setTimeout(
      () => (
        this.pendingTimers.delete(pluginId),
        void this.refreshPlugin(pluginId).catch(() => undefined)
      ),
      retryInMs,
    );
    timer.unref?.();
    this.pendingTimers.set(pluginId, timer);
  }

  /**
   * Stops a source's subscription.
   *
   * @param sourceId - Source id.
   */
  unsubscribe(sourceId: string): void {
    this.active.get(sourceId)?.stop();
    this.active.delete(sourceId);
  }

  /**
   * Stops every subscription of a plugin (disable, uninstall).
   *
   * @param pluginId - Plugin id.
   */
  unsubscribePlugin(pluginId: string): void {
    for (const [sourceId, sub] of this.active)
      if (sub.pluginId === pluginId) this.unsubscribe(sourceId);
  }

  /** Stops everything (quit). */
  stopAll(): void {
    for (const sourceId of [...this.active.keys()]) this.unsubscribe(sourceId);
    this.pendingTimers.forEach((timer) => clearTimeout(timer));
    this.pendingTimers.clear();
  }

  private shouldWatch(source: SourceRow): boolean {
    if (source.syncState === 'paused' || parseSchedule(source.scheduleJson).mode !== 'watch')
      return false;
    return Boolean(this.deps.registry.get(source.pluginId)?.plugin.watch);
  }

  private async subscribe(source: SourceRow): Promise<void> {
    const entry = this.deps.registry.get(source.pluginId)!;
    const hooks = {
      signal: new AbortController().signal,
      onProgress: () => undefined,
      isKnown: async () => ({}),
    };
    const ctx = this.deps.registry.syncContext(source, hooks);
    try {
      const stop = await entry.plugin.watch!(ctx, (batch) => this.apply(source.id, batch));
      this.active.set(source.id, { pluginId: source.pluginId, stop });
    } catch (error) {
      this.deps.logger.warn({ err: error, sourceId: source.id }, 'Could not watch source');
    }
  }

  private apply(sourceId: string, raw: unknown): void {
    const source = this.load(sourceId);
    if (!source || source.syncState === 'paused') return;
    try {
      const batch = validateBatch(raw);
      const now = (this.deps.clock ?? systemClock)();
      const result = this.deps.writer.apply(
        batch,
        { sourceId, runId: source.syncRunId ?? WATCH_RUN_ID, now },
        { saveCursor: false },
      );
      if (result.touchedAssetIds.length > 0) this.deps.events.emit('library.changed', {});
    } catch (error) {
      this.deps.logger.warn({ err: error, sourceId }, 'Dropped invalid watch batch');
    }
  }

  private load(sourceId: string): SourceRow | undefined {
    return this.deps.db.select().from(schema.sources).where(eq(schema.sources.id, sourceId)).get();
  }
}
