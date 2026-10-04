import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, gt, isNull, asc } from 'drizzle-orm';
import { systemClock, type Clock } from '../clock';
import type { JobQueue } from '../jobs/job-queue';
import { PRIORITY } from '../jobs/job-types';
import type { EnricherRegistry } from './enricher-registry';
import { enrichmentPlan } from './planner';
import type { EnricherEntry } from './types';

const { assets, enrichmentRuns } = schema;
const LIBRARY_CHUNK = 500;

type AssetState = Pick<typeof assets.$inferSelect, 'id' | 'mime' | 'thumbState'>;
type Runs = Map<string, string>;

/**
 * Dedupe key of an enrich job (SPEC 7.3): one per asset, plugin and version.
 *
 * @param assetId - Asset id.
 * @param entry - Enricher.
 * @returns The key.
 */
export const enrichDedupeKey = (assetId: string, entry: EnricherEntry): string =>
  `enrich:${assetId}:${entry.manifest.id}@${entry.manifest.version}`;

/**
 * Queues enrichment (SPEC 7.5) when an asset is created or changed, when its
 * thumbnail is ready, when an enricher it waits on finishes, or for a whole
 * library. An enricher is queued only when its dependencies have run for the
 * asset and its input exists, so nothing polls.
 */
export class EnrichScheduler {
  constructor(
    private readonly db: LibraryDb,
    private readonly queue: JobQueue,
    private readonly registry: EnricherRegistry,
    private readonly clock: Clock = systemClock,
  ) {}

  /** New or changed content: forget earlier runs and plan from scratch. */
  contentChanged(assetIds: readonly string[]): void {
    for (const id of assetIds) {
      this.db.delete(enrichmentRuns).where(eq(enrichmentRuns.assetId, id)).run();
      this.queueReady(id);
    }
  }

  /** Thumbnail finished (or failed): thumbnail-input enrichers may start. */
  thumbnailReady(assetId: string): void {
    this.queueReady(assetId);
  }

  /** An enricher finished an asset: its dependents may start. */
  completed(assetId: string): void {
    this.queueReady(assetId);
  }

  /**
   * Queues one enricher for every asset in the library (first install,
   * enabling, "Re-run on library"). Works through the library in chunks.
   *
   * @param pluginId - Enricher id.
   * @returns Number of assets examined.
   */
  async queueLibrary(pluginId: string): Promise<number> {
    let after = '';
    let total = 0;
    this.db.delete(enrichmentRuns).where(eq(enrichmentRuns.pluginId, pluginId)).run();
    for (;;) {
      const ids = this.libraryChunk(after);
      if (ids.length === 0) return total;
      ids.forEach((id) => this.queueReady(id));
      total += ids.length;
      after = ids.at(-1)!;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Records that an enricher finished (or skipped, or gave up on) an asset.
   *
   * @param assetId - Asset id.
   * @param entry - Enricher.
   * @param status - Outcome.
   * @param error - Failure message.
   */
  recordRun(
    assetId: string,
    entry: EnricherEntry,
    status: 'done' | 'skipped' | 'failed',
    error?: string,
  ): void {
    const values = {
      pluginVersion: entry.manifest.version,
      status,
      error: error ?? null,
      completedAt: this.clock(),
    };
    this.db
      .insert(enrichmentRuns)
      .values({ assetId, pluginId: entry.manifest.id, ...values })
      .onConflictDoUpdate({
        target: [enrichmentRuns.assetId, enrichmentRuns.pluginId],
        set: values,
      })
      .run();
  }

  private libraryChunk(after: string): string[] {
    return this.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(gt(assets.id, after), isNull(assets.missingSince)))
      .orderBy(asc(assets.id))
      .limit(LIBRARY_CHUNK)
      .all()
      .map((r) => r.id);
  }

  private queueReady(assetId: string): void {
    const asset = this.db
      .select({ id: assets.id, mime: assets.mime, thumbState: assets.thumbState })
      .from(assets)
      .where(eq(assets.id, assetId))
      .get();
    if (!asset) return;
    const plan = enrichmentPlan(this.registry.list(), asset.mime);
    const runs = this.runsOf(assetId);
    const planned = new Set(plan.map((e) => e.manifest.id));
    for (const entry of plan) this.consider(asset, entry, runs, planned);
  }

  private consider(
    asset: AssetState,
    entry: EnricherEntry,
    runs: Runs,
    planned: Set<string>,
  ): void {
    if (
      runs.get(entry.manifest.id) === entry.manifest.version ||
      !this.dependenciesMet(entry, runs, planned)
    )
      return;
    if (entry.manifest.enricher.input === 'thumbnail' && asset.thumbState === 'failed') {
      this.recordRun(asset.id, entry, 'skipped', 'No thumbnail could be made');
      runs.set(entry.manifest.id, entry.manifest.version);
      return;
    }
    if (entry.manifest.enricher.input === 'thumbnail' && asset.thumbState !== 'ready') return;
    this.queue.enqueue({
      kind: 'enrich',
      pluginId: entry.manifest.id,
      assetId: asset.id,
      priority: PRIORITY.background,
      dedupeKey: enrichDedupeKey(asset.id, entry),
    });
  }

  private dependenciesMet(entry: EnricherEntry, runs: Runs, planned: Set<string>): boolean {
    return entry.manifest.enricher.dependsOn.every((dep) => {
      if (!planned.has(dep)) return true;
      return runs.get(dep) === this.registry.get(dep)?.manifest.version;
    });
  }

  private runsOf(assetId: string): Runs {
    const rows = this.db
      .select({ pluginId: enrichmentRuns.pluginId, version: enrichmentRuns.pluginVersion })
      .from(enrichmentRuns)
      .where(eq(enrichmentRuns.assetId, assetId))
      .all();
    return new Map(rows.map((r) => [r.pluginId, r.version]));
  }
}
