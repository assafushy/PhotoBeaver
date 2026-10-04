import type { AssetView } from '@photobeaver/plugin-sdk';
import type { EnrichOutcome } from '@photobeaver/shared/rpc';
import type { JobQueue } from '../jobs/job-queue';
import type { JobRow } from '../jobs/job-types';
import { buildAssetView } from './asset-view';
import type { LibraryDb } from '@photobeaver/db';
import type { EnricherEntry } from './types';

export const BATCH_LIMIT = 32;
const BATCH_LEASE_MS = 10 * 60 * 1000;
const BATCH_OWNER = `${process.pid}:enrich-batch`;

export interface BatchJobs {
  extras: JobRow[];
  views: AssetView[];
}

/**
 * Whether an enricher should get grouped `enrichBatch` calls.
 *
 * @param entry - Enricher.
 * @returns True when it implements enrichBatch.
 */
export async function supportsBatch(entry: EnricherEntry): Promise<boolean> {
  if (!entry.client.enrichBatch) return false;
  return entry.client.supportsBatch ? entry.client.supportsBatch() : true;
}

/**
 * Leases up to 31 more queued jobs of the same plugin and builds their views
 * (SPEC 7.5: jobs are grouped for enrichBatch, up to 32 assets per call).
 *
 * @param db - Library database.
 * @param queue - Job queue.
 * @param entry - Enricher.
 * @param first - The job the lane leased.
 * @returns Extra jobs and the views of every asset still present.
 */
export function collectBatch(
  db: LibraryDb,
  queue: JobQueue,
  entry: EnricherEntry,
  first: JobRow,
): BatchJobs {
  const extras = queue.leaseMany(
    ['enrich'],
    BATCH_OWNER,
    BATCH_LEASE_MS,
    { pluginIds: [entry.manifest.id] },
    BATCH_LIMIT - 1,
  );
  const views = [first, ...extras]
    .map((job) => buildAssetView(db, job.asset_id!, entry.manifest.enricher.dependsOn))
    .filter((view): view is AssetView => view !== null);
  return { extras, views };
}

/**
 * Settles the extra jobs of a batch after the call.
 *
 * @param queue - Job queue.
 * @param extras - Jobs leased for the batch.
 * @param error - The batch failure, or null on success.
 */
export function settleExtras(queue: JobQueue, extras: readonly JobRow[], error: unknown): void {
  for (const job of extras) {
    if (error === null) queue.complete(job.id);
    else queue.fail(job.id, error);
  }
}

/**
 * Orders batch outcomes by asset id, treating missing ones as skipped.
 *
 * @param views - Assets sent.
 * @param outcomes - Plugin answers.
 * @returns Outcome per asset.
 */
export function outcomesByAsset(
  views: readonly AssetView[],
  outcomes: readonly [string, EnrichOutcome][],
): Map<string, EnrichOutcome> {
  const byId = new Map(outcomes);
  return new Map(views.map((view) => [view.id, byId.get(view.id) ?? { skipped: true }]));
}
