import { schema, type LibraryDb } from '@photobeaver/db';
import {
  isAuthRequiredError,
  isRateLimitedError,
  type SyncProgress,
} from '@photobeaver/plugin-sdk';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { systemClock, type Clock } from '../clock';
import type { ConnectorRegistry, CoreLog } from '../connectors/registry';
import type { EventSink } from '../events/event-sink';
import type { JobContext } from '../jobs/lane';
import { isHostCrashedError } from '../plugins/host-errors';
import { sourceState } from '../scheduler/source-state';
import type { BatchWriter } from './batch-writer';
import { validateBatch } from './media-item-schema';

type SourceRow = typeof schema.sources.$inferSelect;

export interface SyncRunnerDeps {
  db: LibraryDb;
  writer: BatchWriter;
  registry: ConnectorRegistry;
  events: EventSink;
  logger: CoreLog;
  clock?: Clock;
  random?: () => number;
  batchDelayMs?: number;
}

interface RunState {
  source: SourceRow;
  runId: string;
  signal: AbortSignal;
}

/**
 * Executes `sync_source` jobs: pulls batches from the connector and commits each
 * one with its cursor. Outcomes update the source's schedule; the job itself
 * always completes, because retry timing belongs to the scheduler (SPEC 7.2).
 */
export class SyncRunner {
  private readonly clock: Clock;
  private readonly random: () => number;

  constructor(private readonly deps: SyncRunnerDeps) {
    this.clock = deps.clock ?? systemClock;
    this.random = deps.random ?? Math.random;
  }

  /**
   * Job handler for `sync_source`.
   *
   * @param ctx - The leased job and its abort signal.
   */
  run = async ({ job, signal }: JobContext): Promise<void> => {
    const source = this.loadSource(job.source_id);
    if (!source || source.syncState === 'paused') return;
    const run: RunState = { source, runId: this.ensureRunId(source), signal };
    sourceState.running(this.deps.db, source.id, this.clock());
    this.deps.events.emit('sources.changed', {});
    try {
      await this.execute(run);
    } catch (error) {
      this.recordFailure(source, error, signal);
    }
    this.deps.events.emit('sources.changed', {});
  };

  private async execute(run: RunState): Promise<void> {
    const entry = this.deps.registry.get(run.source.pluginId);
    if (!entry) throw new Error(`Connector not installed: ${run.source.pluginId}`);
    const ctx = this.deps.registry.syncContext(run.source, this.hooks(run));
    let fullScan = false;
    for await (const raw of entry.plugin.sync(ctx, run.source.syncCursor)) {
      run.signal.throwIfAborted();
      fullScan = this.commitBatch(run, raw);
      if (this.deps.batchDelayMs)
        await new Promise((resolve) => setTimeout(resolve, this.deps.batchDelayMs));
    }
    run.signal.throwIfAborted();
    const tombstoned = this.deps.writer.finishRun(fullScan, this.writeContext(run));
    if (tombstoned > 0) this.deps.events.emit('library.changed', {});
    sourceState.succeeded(
      this.deps.db,
      this.loadSource(run.source.id)!,
      this.clock(),
      this.random(),
    );
  }

  private commitBatch(run: RunState, raw: unknown): boolean {
    const batch = validateBatch(raw);
    if (batch.rejected > 0)
      this.deps.logger.warn(
        { sourceId: run.source.id, rejected: batch.rejected },
        'Dropped invalid items',
      );
    const result = this.deps.writer.apply(batch, this.writeContext(run));
    if (batch.progress) this.emitProgress(run.source.id, batch.progress);
    if (result.touchedAssetIds.length > 0) this.deps.events.emit('library.changed', {});
    return batch.isFullScan === true;
  }

  private hooks(run: RunState) {
    return {
      signal: run.signal,
      onProgress: (progress: SyncProgress) => this.emitProgress(run.source.id, progress),
      isKnown: async (ids: string[]) => this.deps.writer.markKnown(ids, this.writeContext(run)),
    };
  }

  private emitProgress(sourceId: string, progress: SyncProgress): void {
    this.deps.events.emit('sync.progress', { sourceId, ...progress });
  }

  private writeContext(run: RunState) {
    return { sourceId: run.source.id, runId: run.runId, now: this.clock() };
  }

  private ensureRunId(source: SourceRow): string {
    if (source.syncRunId) return source.syncRunId;
    const runId = ulid(this.clock());
    this.deps.db
      .update(schema.sources)
      .set({ syncRunId: runId })
      .where(eq(schema.sources.id, source.id))
      .run();
    return runId;
  }

  private loadSource(sourceId: string | null): SourceRow | undefined {
    if (!sourceId) return undefined;
    return this.deps.db.select().from(schema.sources).where(eq(schema.sources.id, sourceId)).get();
  }

  private recordFailure(source: SourceRow, error: unknown, signal: AbortSignal): void {
    const now = this.clock();
    if (signal.aborted) return sourceState.cancelled(this.deps.db, source.id);
    if (isHostCrashedError(error)) {
      sourceState.queued(this.deps.db, source.id);
      throw error;
    }
    this.deps.logger.warn({ err: error, sourceId: source.id }, 'Sync failed');
    if (isAuthRequiredError(error))
      return sourceState.authRequired(this.deps.db, source.id, now, error);
    if (isRateLimitedError(error))
      return sourceState.rateLimited(this.deps.db, source.id, now, error.retryAfterSec);
    sourceState.failed(this.deps.db, this.loadSource(source.id) ?? source, now, error);
  }
}
