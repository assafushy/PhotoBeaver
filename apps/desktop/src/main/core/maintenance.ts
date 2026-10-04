import type { LibraryDb } from '@photobeaver/db';
import { deleteAssets, expiredMissingAssets } from './assets/purge';
import { DAY_MS, MINUTE_MS, systemClock, type Clock } from './clock';
import type { CoreLog } from './connectors/registry';
import type { JobQueue } from './jobs/job-queue';

export const MISSING_RETENTION_MS = 30 * DAY_MS;

export interface MaintenanceDeps {
  db: LibraryDb;
  queue: JobQueue;
  logger: CoreLog;
  removeAssetFiles: (assetIds: string[]) => Promise<void>;
  tidyFaces?: () => void;
  clock?: Clock;
}

/**
 * Runs once a minute: recovers expired leases, deletes old jobs, purges assets
 * that have been missing for 30 days (SPEC 4.3, 7.3), and tidies faces (orphan
 * embeddings, people without faces).
 */
export class Maintenance {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: MaintenanceDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.run(), MINUTE_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Runs one maintenance pass.
   *
   * @returns Counts of recovered leases, deleted jobs and purged assets.
   */
  async run(): Promise<{ recovered: number; cleaned: number; purged: number }> {
    const now = (this.deps.clock ?? systemClock)();
    const recovered = this.deps.queue.recoverLeases();
    const cleaned = this.deps.queue.cleanup();
    const expired = expiredMissingAssets(this.deps.db, now - MISSING_RETENTION_MS);
    const purged =
      expired.length > 0
        ? this.deps.db.transaction((tx) => deleteAssets(tx as unknown as LibraryDb, expired))
        : [];
    await this.deps.removeAssetFiles(purged);
    this.deps.tidyFaces?.();
    if (recovered + cleaned + purged.length > 0)
      this.deps.logger.info({ recovered, cleaned, purged: purged.length }, 'Maintenance pass');
    return { recovered, cleaned, purged: purged.length };
  }
}
