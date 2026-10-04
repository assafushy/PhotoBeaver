import { rm } from 'node:fs/promises';
import type { LibraryDb } from '@photobeaver/db';
import type { AssetView, EnrichContext } from '@photobeaver/plugin-sdk';
import { enrichmentResultSchema, type EnrichOutcome } from '@photobeaver/shared/rpc';
import { systemClock, type Clock } from '../clock';
import type { CoreLog } from '../connectors/registry';
import type { EventSink } from '../events/event-sink';
import type { JobContext } from '../jobs/lane';
import type { JobRow } from '../jobs/job-types';
import { isHostCrashedError } from '../plugins/host-errors';
import type { JobQueue } from '../jobs/job-queue';
import { applyEnrichmentResult, type ApplyContext } from './apply-result';
import { collectBatch, outcomesByAsset, settleExtras, supportsBatch } from './batch';
import { buildAssetView } from './asset-view';
import { createEnrichContext, type EnrichContextDeps } from './enrich-context';
import type { EnrichScheduler } from './enrich-scheduler';
import type { EnricherRegistry } from './enricher-registry';
import type { Finalizer } from './finalizer';
import { storeSuggestions } from './identity';
import type { MergeService } from './merge-service';
import type { EnricherEntry } from './types';

export interface EnrichRunnerDeps {
  db: LibraryDb;
  queue: JobQueue;
  registry: EnricherRegistry;
  scheduler: EnrichScheduler;
  merges: MergeService;
  finalizer: Finalizer;
  context: EnrichContextDeps;
  events: EventSink;
  logger: CoreLog;
  clock?: Clock;
}

/**
 * Runs `enrich` and `plugin_task` jobs (SPEC 7.5): builds the AssetView, calls
 * the enricher, validates and applies its result, records the run, applies
 * merges and suggestions, then queues dependents and finalize.
 */
export class EnrichRunner {
  constructor(private readonly deps: EnrichRunnerDeps) {}

  run = async ({ job, signal }: JobContext): Promise<void> => {
    const entry = job.plugin_id ? this.deps.registry.get(job.plugin_id) : undefined;
    if (!entry) return;
    if (job.kind === 'plugin_task') return this.finalize(entry, signal);
    if (await supportsBatch(entry)) await this.enrichBatch(entry, job, signal);
    else await this.enrichOne(entry, job, signal);
    this.deps.finalizer.jobSettled(entry, 1);
  };

  private async enrichBatch(entry: EnricherEntry, job: JobRow, signal: AbortSignal): Promise<void> {
    const { extras, views } = collectBatch(this.deps.db, this.deps.queue, entry, job);
    await this.withContext(entry, views, signal, async (ctx) => {
      try {
        const results = views.length ? await entry.client.enrichBatch!(ctx, views) : [];
        outcomesByAsset(views, results).forEach((outcome, assetId) =>
          this.settle(entry, assetId, outcome),
        );
        settleExtras(this.deps.queue, extras, null);
      } catch (error) {
        settleExtras(this.deps.queue, extras, error);
        throw error;
      }
    });
  }

  private async enrichOne(entry: EnricherEntry, job: JobRow, signal: AbortSignal): Promise<void> {
    const view = buildAssetView(this.deps.db, job.asset_id!, entry.manifest.enricher.dependsOn);
    if (!view) return;
    await this.withContext(entry, [view], signal, async (ctx) => {
      try {
        this.settle(entry, view.id, await entry.client.enrich(ctx, view));
      } catch (error) {
        this.onError(entry, job, view, error);
      }
    });
  }

  private async withContext(
    entry: EnricherEntry,
    views: readonly AssetView[],
    signal: AbortSignal,
    work: (ctx: EnrichContext<unknown>) => Promise<void>,
  ): Promise<void> {
    const tempFiles: string[] = [];
    const scope = { manifest: entry.manifest, assetIds: new Set(views.map((v) => v.id)) };
    try {
      await work(createEnrichContext(this.deps.context, scope, signal, tempFiles));
    } finally {
      await Promise.all(tempFiles.map((file) => rm(file, { force: true })));
    }
  }

  private settle(entry: EnricherEntry, assetId: string, outcome: EnrichOutcome): void {
    if (outcome.skipped) this.deps.scheduler.recordRun(assetId, entry, 'skipped');
    else this.apply(entry, assetId, outcome.result);
    this.deps.scheduler.completed(assetId);
  }

  private apply(entry: EnricherEntry, assetId: string, raw: unknown): void {
    const result = this.parseResult(entry, assetId, raw);
    if (!result) return this.deps.scheduler.recordRun(assetId, entry, 'failed', 'Invalid result');
    const canMerge = entry.manifest.permissions.assets === 'merge';
    applyEnrichmentResult(this.applyContext(entry, assetId, canMerge), result);
    this.deps.scheduler.recordRun(assetId, entry, 'done');
    if (canMerge) this.applyIdentityRequests(entry, assetId, result);
    this.deps.events.emit('library.changed', {});
  }

  private parseResult(entry: EnricherEntry, assetId: string, raw: unknown) {
    const parsed = enrichmentResultSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    this.deps.logger.warn(
      { pluginId: entry.manifest.id, assetId, issues: parsed.error.issues.length },
      'Dropped invalid enrichment result',
    );
    return null;
  }

  private applyContext(entry: EnricherEntry, assetId: string, canMerge: boolean): ApplyContext {
    return {
      db: this.deps.db,
      assetId,
      pluginId: entry.manifest.id,
      pluginVersion: entry.manifest.version,
      rank: entry.manifest.enricher.produces.includes('exif') ? 'exif' : 'enricher',
      canMerge,
      now: this.now(),
    };
  }

  private applyIdentityRequests(
    entry: EnricherEntry,
    assetId: string,
    result: {
      mergeWith?: string[];
      suggestDuplicates?: { assetIds: string[]; kind: 'exact' | 'near'; confidence: number }[];
    },
  ): void {
    if (result.suggestDuplicates?.length)
      storeSuggestions(this.deps.db, entry.manifest.id, result.suggestDuplicates, this.now());
    if (result.mergeWith?.length)
      this.deps.merges.requested(assetId, result.mergeWith, entry.manifest.id);
  }

  private onError(entry: EnricherEntry, job: JobRow, view: AssetView, error: unknown): never {
    if (!isHostCrashedError(error) && job.attempts >= job.max_attempts) {
      this.deps.scheduler.recordRun(
        view.id,
        entry,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      this.deps.scheduler.completed(view.id);
    }
    throw error;
  }

  private async finalize(entry: EnricherEntry, signal: AbortSignal): Promise<void> {
    if (
      !entry.client.finalize ||
      (entry.client.supportsFinalize && !(await entry.client.supportsFinalize()))
    )
      return;
    const ctx = createEnrichContext(
      this.deps.context,
      { manifest: entry.manifest, assetIds: new Set() },
      signal,
      [],
    );
    await entry.client.finalize(ctx);
    this.deps.finalizer.finalized(entry.manifest.id);
    this.deps.events.emit('library.changed', {});
  }

  private now(): number {
    return (this.deps.clock ?? systemClock)();
  }
}
