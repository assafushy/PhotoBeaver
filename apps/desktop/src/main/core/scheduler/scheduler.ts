import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { systemClock, type Clock } from '../clock';
import type { JobQueue } from '../jobs/job-queue';
import { PRIORITY } from '../jobs/job-types';
import { parseSchedule } from './schedule';
import { sourceState } from './source-state';
import { SCHEDULER_TICK_MS } from './timing';

const { sources, plugins, jobs } = schema;

/**
 * The dedupe key that guarantees a source is never queued twice.
 *
 * @param sourceId - Source id.
 * @returns The key.
 */
export const syncDedupeKey = (sourceId: string): string => `sync:${sourceId}`;

/**
 * Enqueues sync jobs for due sources every 15 seconds (SPEC 7.2).
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: LibraryDb,
    private readonly queue: JobQueue,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Fixes sync states left behind by a crash: sources marked queued or running
   * go back to `queued` if their job still exists, else to `idle`.
   */
  reconcile(): void {
    const stale = this.db
      .select({ id: sources.id })
      .from(sources)
      .where(inArray(sources.syncState, ['queued', 'running']))
      .all();
    for (const { id } of stale) {
      const job = this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.dedupeKey, syncDedupeKey(id)))
        .get();
      this.db
        .update(sources)
        .set({ syncState: job ? 'queued' : 'idle' })
        .where(eq(sources.id, id))
        .run();
    }
  }

  /** Runs a tick now and then every 15 seconds. */
  start(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), SCHEDULER_TICK_MS);
    this.timer.unref?.();
  }

  /** Stops ticking. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Queues every due poll-mode source of an enabled, healthy plugin.
   *
   * @returns Ids of sources that were queued.
   */
  tick(): string[] {
    const due = this.dueSources().filter(
      (source) => parseSchedule(source.scheduleJson).mode === 'poll',
    );
    for (const source of due) this.enqueue(source.id, source.pluginId, PRIORITY.background);
    return due.map((source) => source.id);
  }

  /**
   * Queues a sync now at UI priority ("Sync now").
   *
   * @param sourceId - Source id.
   * @param pluginId - Owning plugin id.
   */
  syncNow(sourceId: string, pluginId: string): void {
    this.enqueue(sourceId, pluginId, PRIORITY.ui);
  }

  private enqueue(sourceId: string, pluginId: string, priority: number): void {
    this.queue.enqueue({
      kind: 'sync_source',
      sourceId,
      pluginId,
      priority,
      dedupeKey: syncDedupeKey(sourceId),
    });
    sourceState.queued(this.db, sourceId);
  }

  private dueSources() {
    return this.db
      .select({ id: sources.id, pluginId: sources.pluginId, scheduleJson: sources.scheduleJson })
      .from(sources)
      .innerJoin(plugins, eq(plugins.id, sources.pluginId))
      .where(
        and(
          inArray(sources.syncState, ['idle', 'error']),
          lte(sources.nextRunAt, this.clock()),
          eq(plugins.enabled, 1),
          eq(plugins.health, 'ok'),
        ),
      )
      .all();
  }
}
