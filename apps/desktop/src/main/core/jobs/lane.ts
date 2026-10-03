import { SECOND_MS } from '../clock';
import type { JobQueue } from './job-queue';
import type { JobKind, JobRow } from './job-types';

export interface JobContext {
  job: JobRow;
  signal: AbortSignal;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

export interface LaneLogger {
  error(obj: object, msg: string): void;
}

export interface LaneOptions {
  name: string;
  concurrency: number;
  handlers: Partial<Record<JobKind, JobHandler>>;
  leaseMs?: number;
  heartbeatMs?: number;
  idlePollMs?: number;
}

const DEFAULT_LEASE_MS = 120 * SECOND_MS;
const DEFAULT_HEARTBEAT_MS = 30 * SECOND_MS;
const DEFAULT_IDLE_POLL_MS = SECOND_MS;
export const SHUTDOWN_GRACE_MS = 5 * SECOND_MS;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A worker lane (SPEC 7.1): leases jobs of its kinds up to a concurrency limit,
 * heartbeats them, and completes or fails them based on the handler outcome.
 */
export class Lane {
  private readonly inFlight = new Map<number, { promise: Promise<void>; abort: AbortController }>();
  private readonly jobs = new Map<number, JobRow>();
  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly kinds: JobKind[];
  private readonly owner: string;

  constructor(
    private readonly queue: JobQueue,
    private readonly options: LaneOptions,
    private readonly logger: LaneLogger,
  ) {
    this.kinds = Object.keys(options.handlers) as JobKind[];
    this.owner = `${process.pid}:${options.name}`;
  }

  /** Starts leasing jobs. */
  start(): void {
    this.running = true;
    this.pump();
  }

  /** Asks the lane to look for work now (e.g. after an enqueue). */
  wake(): void {
    if (this.running) this.pump();
  }

  /**
   * Stops leasing, waits up to the grace period for in-flight jobs, then aborts them.
   * Aborted jobs keep their lease and are recovered on the next start.
   */
  async stop(graceMs = SHUTDOWN_GRACE_MS): Promise<void> {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const all = Promise.allSettled([...this.inFlight.values()].map((entry) => entry.promise));
    await Promise.race([all, delay(graceMs)]);
    this.inFlight.forEach((entry) => entry.abort.abort());
  }

  /**
   * Aborts in-flight jobs matching a predicate (e.g. the sync of a removed source).
   *
   * @param predicate - Selects jobs to abort.
   */
  abortWhere(predicate: (job: JobRow) => boolean): void {
    this.jobs.forEach((job, id) => {
      if (predicate(job)) this.inFlight.get(id)?.abort.abort();
    });
  }

  private pump(): void {
    while (this.running && this.inFlight.size < this.options.concurrency) {
      const job = this.queue.lease(this.kinds, this.owner, this.leaseMs());
      if (!job) return this.scheduleIdlePoll();
      this.track(job);
    }
  }

  private track(job: JobRow): void {
    const abort = new AbortController();
    this.jobs.set(job.id, job);
    const promise = this.execute(job, abort.signal).finally(() => {
      this.inFlight.delete(job.id);
      this.jobs.delete(job.id);
      this.pump();
    });
    this.inFlight.set(job.id, { promise, abort });
  }

  private async execute(job: JobRow, signal: AbortSignal): Promise<void> {
    const beat = setInterval(
      () => this.queue.heartbeat(job.id, this.owner, this.leaseMs()),
      this.heartbeatMs(),
    );
    try {
      await this.options.handlers[job.kind]!({ job, signal });
      this.settle(job, signal, null);
    } catch (error) {
      this.settle(job, signal, error);
    } finally {
      clearInterval(beat);
    }
  }

  private settle(job: JobRow, signal: AbortSignal, error: unknown): void {
    if (signal.aborted && !this.running) return;
    if (error === null || signal.aborted) return this.queue.complete(job.id);
    this.logger.error({ err: error, jobId: job.id, kind: job.kind }, 'Job failed');
    this.queue.fail(job.id, error);
  }

  private scheduleIdlePoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.wake();
    }, this.options.idlePollMs ?? DEFAULT_IDLE_POLL_MS);
    this.pollTimer.unref?.();
  }

  private leaseMs(): number {
    return this.options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  private heartbeatMs(): number {
    return this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  }
}
