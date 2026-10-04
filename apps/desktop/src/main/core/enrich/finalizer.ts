import { MINUTE_MS, systemClock, type Clock } from '../clock';
import type { JobQueue } from '../jobs/job-queue';
import { PRIORITY } from '../jobs/job-types';
import type { EnricherEntry } from './types';

export const FINALIZE_DEBOUNCE_MS = 10 * MINUTE_MS;

/**
 * Schedules an enricher's `finalize()` when its queue drains, at most once per
 * 10 minutes (SPEC 7.5), as a durable `plugin_task` job.
 */
export class Finalizer {
  private readonly lastRun = new Map<string, number>();

  constructor(
    private readonly queue: JobQueue,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Called after an enrich job settles. Queues finalize only when the plugin's
   * work has truly drained: none of its jobs pending, none of its dependencies'
   * jobs pending, no sync running, and no thumbnails pending when it reads them.
   *
   * @param entry - The enricher.
   * @param stillLeased - Jobs of this plugin the caller still holds (the current one).
   */
  jobSettled(entry: EnricherEntry, stillLeased: number): void {
    const pluginId = entry.manifest.id;
    if (!this.drained(entry, stillLeased)) return;
    const runAfter = Math.max(
      this.clock(),
      (this.lastRun.get(pluginId) ?? 0) + FINALIZE_DEBOUNCE_MS,
    );
    this.queue.enqueue({
      kind: 'plugin_task',
      pluginId,
      payload: { task: 'finalize' },
      priority: PRIORITY.background,
      runAfter,
      dedupeKey: `finalize:${pluginId}`,
    });
  }

  private drained(entry: EnricherEntry, stillLeased: number): boolean {
    const { id, enricher } = entry.manifest;
    if (
      this.queue.pendingFor('enrich', id) > stillLeased ||
      this.queue.pendingOfKind('sync_source') > 0
    )
      return false;
    if (enricher.input === 'thumbnail' && this.queue.pendingOfKind('thumbnail') > 0) return false;
    return enricher.dependsOn.every((dep) => this.queue.pendingFor('enrich', dep) === 0);
  }

  /** Records that finalize ran. */
  finalized(pluginId: string): void {
    this.lastRun.set(pluginId, this.clock());
  }
}
