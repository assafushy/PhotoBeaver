import type Database from 'better-sqlite3';
import { DAY_MS, HOUR_MS, SECOND_MS, systemClock, type Clock } from '../clock';
import { PRIORITY, type JobKind, type JobRow, type NewJob } from './job-types';

const RETRY_BASE_MS = 30 * SECOND_MS;
const RETRY_CAP_MS = HOUR_MS;
const DONE_RETENTION_MS = DAY_MS;
const DEAD_RETENTION_MS = 30 * DAY_MS;

/**
 * Backoff before retrying a failed job.
 *
 * @param attempts - Attempts made so far (at least 1).
 * @returns Delay in milliseconds.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_CAP_MS);
}

function jobInsertParams(job: NewJob, now: number) {
  return [
    job.kind,
    job.pluginId ?? null,
    job.sourceId ?? null,
    job.assetId ?? null,
    job.payload === undefined ? null : JSON.stringify(job.payload),
    job.priority ?? PRIORITY.background,
    job.maxAttempts ?? 5,
    job.runAfter ?? now,
    job.dedupeKey ?? null,
    now,
    now,
  ];
}

/**
 * Durable SQLite-backed job queue (SPEC 7.3). Completed and dead jobs release
 * their dedupe key so the same work can be queued again later.
 */
export class JobQueue {
  private readonly listeners = new Set<() => void>();
  private notifyPending = false;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Registers a callback fired after enqueues. Notification is deferred to the next
   * tick (and coalesced) so a listener never leases inside the caller's transaction.
   *
   * @param listener - Called after insert.
   * @returns Unsubscribe function.
   */
  onEnqueue(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Inserts a job unless one with the same dedupe key exists. When it exists and
   * is still queued, its priority is raised to the new one if that is more urgent.
   *
   * @param job - The job to queue.
   * @returns True when a new row was inserted.
   */
  enqueue(job: NewJob): boolean {
    const inserted = this.insert(job);
    if (!inserted && job.dedupeKey && job.priority !== undefined) {
      this.raisePriority(job.dedupeKey, job.priority);
    }
    if (inserted) this.notify();
    return inserted;
  }

  private notify(): void {
    if (this.notifyPending) return;
    this.notifyPending = true;
    setImmediate(() => {
      this.notifyPending = false;
      this.listeners.forEach((listener) => listener());
    });
  }

  /**
   * Atomically leases the most urgent runnable job of the given kinds.
   *
   * @param kinds - Job kinds this worker handles.
   * @param owner - Lease owner id.
   * @param leaseMs - Lease duration.
   * @returns The leased job, or null when nothing is runnable.
   */
  lease(kinds: readonly JobKind[], owner: string, leaseMs: number): JobRow | null {
    const now = this.clock();
    const marks = kinds.map(() => '?').join(',');
    const row = this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'leased', lease_owner = ?, lease_expires_at = ?,
           attempts = attempts + 1, updated_at = ?
         WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ?
                     AND kind IN (${marks}) ORDER BY priority, run_after, id LIMIT 1)
         RETURNING *`,
      )
      .get(owner, now + leaseMs, now, now, ...kinds);
    return (row as JobRow | undefined) ?? null;
  }

  /**
   * Extends a lease held by the owner.
   *
   * @param id - Job id.
   * @param owner - Lease owner id.
   * @param leaseMs - New lease duration from now.
   * @returns True if the lease is still held.
   */
  heartbeat(id: number, owner: string, leaseMs: number): boolean {
    const now = this.clock();
    const result = this.sqlite
      .prepare(
        `UPDATE jobs SET lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
      )
      .run(now + leaseMs, now, id, owner);
    return result.changes > 0;
  }

  /**
   * Marks a job done and releases its dedupe key.
   *
   * @param id - Job id.
   */
  complete(id: number): void {
    this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'done', dedupe_key = NULL, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(this.clock(), id);
  }

  /**
   * Records a failure: requeues with backoff, or marks dead after max attempts.
   *
   * @param id - Job id.
   * @param error - The failure.
   * @returns The resulting status.
   */
  fail(id: number, error: unknown): 'queued' | 'dead' {
    const job = this.get(id);
    if (!job) return 'dead';
    const message = error instanceof Error ? error.message : String(error);
    return job.attempts >= job.max_attempts
      ? this.markDead(id, message)
      : this.requeue(id, message, this.clock() + retryDelayMs(job.attempts));
  }

  /**
   * Returns leased jobs to the queue. With `allOwners`, every lease is recovered
   * (safe at startup because the single-instance lock rules out other workers).
   *
   * @param options - Recover only expired leases, or all of them.
   * @returns Number of jobs recovered.
   */
  recoverLeases(options: { allOwners?: boolean } = {}): number {
    const now = this.clock();
    const expiry = options.allOwners ? '' : 'AND lease_expires_at < ?';
    const params = options.allOwners ? [now] : [now, now];
    return this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
           updated_at = ? WHERE status = 'leased' ${expiry}`,
      )
      .run(...params).changes;
  }

  /**
   * Deletes done jobs older than 24h and dead jobs older than 30 days.
   *
   * @returns Number of rows deleted.
   */
  cleanup(): number {
    const now = this.clock();
    return this.sqlite
      .prepare(
        `DELETE FROM jobs WHERE (status = 'done' AND updated_at < ?)
           OR (status = 'dead' AND updated_at < ?)`,
      )
      .run(now - DONE_RETENTION_MS, now - DEAD_RETENTION_MS).changes;
  }

  /**
   * Reads a job by id.
   *
   * @param id - Job id.
   * @returns The row or undefined.
   */
  get(id: number): JobRow | undefined {
    return this.sqlite.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  }

  /**
   * Deletes queued jobs matching a column value (used when a source is removed).
   *
   * @param column - `source_id` or `asset_id`.
   * @param value - The id to match.
   */
  deleteQueued(column: 'source_id' | 'asset_id', value: string): void {
    this.sqlite
      .prepare(`DELETE FROM jobs WHERE ${column} = ? AND status IN ('queued', 'failed')`)
      .run(value);
  }

  private insert(job: NewJob): boolean {
    const now = this.clock();
    const result = this.sqlite
      .prepare(
        `INSERT INTO jobs (kind, plugin_id, source_id, asset_id, payload_json, priority,
           max_attempts, run_after, dedupe_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(...jobInsertParams(job, now));
    return result.changes > 0;
  }

  private raisePriority(dedupeKey: string, priority: number): void {
    this.sqlite
      .prepare(
        `UPDATE jobs SET priority = ?, updated_at = ?
         WHERE dedupe_key = ? AND status = 'queued' AND priority > ?`,
      )
      .run(priority, this.clock(), dedupeKey, priority);
  }

  private markDead(id: number, message: string): 'dead' {
    this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'dead', last_error = ?, dedupe_key = NULL, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(message, this.clock(), id);
    return 'dead';
  }

  private requeue(id: number, message: string, runAfter: number): 'queued' {
    this.sqlite
      .prepare(
        `UPDATE jobs SET status = 'queued', last_error = ?, run_after = ?, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(message, runAfter, this.clock(), id);
    return 'queued';
  }
}
