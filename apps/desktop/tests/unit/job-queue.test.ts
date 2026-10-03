import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/main/core/clock';
import { JobQueue, retryDelayMs } from '../../src/main/core/jobs/job-queue';
import { openTempLibrary, type TempLibrary } from './helpers';

describe('JobQueue', () => {
  let temp: TempLibrary;
  let now: number;
  let queue: JobQueue;

  beforeEach(async () => {
    temp = await openTempLibrary();
    now = 1_000_000;
    queue = new JobQueue(temp.library.sqlite, () => now);
  });

  afterEach(() => temp.cleanup());

  it('dedupes on dedupe_key and raises priority of the queued job', () => {
    expect(queue.enqueue({ kind: 'thumbnail', dedupeKey: 'thumb:a', priority: 50 })).toBe(true);
    expect(queue.enqueue({ kind: 'thumbnail', dedupeKey: 'thumb:a', priority: 10 })).toBe(false);
    expect(queue.lease(['thumbnail'], 'w', 1000)?.priority).toBe(10);
  });

  it('leases by priority then run_after, skipping future jobs and other kinds', () => {
    queue.enqueue({ kind: 'thumbnail', assetId: 'late', priority: 100 });
    queue.enqueue({ kind: 'thumbnail', assetId: 'future', priority: 1, runAfter: now + 5000 });
    queue.enqueue({ kind: 'sync_source', sourceId: 's', priority: 1 });
    queue.enqueue({ kind: 'thumbnail', assetId: 'urgent', priority: 10 });
    const order = [1, 2, 3].map(() => queue.lease(['thumbnail'], 'w', 1000)?.asset_id ?? null);
    expect(order).toEqual(['urgent', 'late', null]);
  });

  it('counts an attempt per lease and extends leases on heartbeat', () => {
    queue.enqueue({ kind: 'thumbnail' });
    const job = queue.lease(['thumbnail'], 'w', 1000)!;
    expect(job.attempts).toBe(1);
    now += 500;
    expect(queue.heartbeat(job.id, 'w', 1000)).toBe(true);
    expect(queue.get(job.id)?.lease_expires_at).toBe(now + 1000);
    expect(queue.heartbeat(job.id, 'other', 1000)).toBe(false);
  });

  it('recovers only expired leases, or all leases at startup', () => {
    queue.enqueue({ kind: 'thumbnail' });
    queue.enqueue({ kind: 'thumbnail' });
    queue.lease(['thumbnail'], 'w', 1000);
    queue.lease(['thumbnail'], 'w', 5000);
    now += 2000;
    expect(queue.recoverLeases()).toBe(1);
    expect(queue.recoverLeases({ allOwners: true })).toBe(1);
  });

  it('retries with backoff, then goes dead and releases the dedupe key', () => {
    queue.enqueue({ kind: 'thumbnail', dedupeKey: 'k', maxAttempts: 2 });
    const first = queue.lease(['thumbnail'], 'w', 1000)!;
    expect(queue.fail(first.id, new Error('x'))).toBe('queued');
    expect(queue.get(first.id)?.run_after).toBe(now + retryDelayMs(1));
    now += retryDelayMs(1);
    queue.lease(['thumbnail'], 'w', 1000);
    expect(queue.fail(first.id, new Error('y'))).toBe('dead');
    expect(queue.get(first.id)).toMatchObject({
      status: 'dead',
      last_error: 'y',
      dedupe_key: null,
    });
    expect(queue.enqueue({ kind: 'thumbnail', dedupeKey: 'k' })).toBe(true);
  });

  it('releases the dedupe key on completion so work can be queued again', () => {
    queue.enqueue({ kind: 'sync_source', dedupeKey: 'sync:s' });
    const job = queue.lease(['sync_source'], 'w', 1000)!;
    expect(queue.enqueue({ kind: 'sync_source', dedupeKey: 'sync:s' })).toBe(false);
    queue.complete(job.id);
    expect(queue.enqueue({ kind: 'sync_source', dedupeKey: 'sync:s' })).toBe(true);
  });

  it('cleans up old done jobs and keeps recent ones', () => {
    queue.enqueue({ kind: 'thumbnail' });
    queue.complete(queue.lease(['thumbnail'], 'w', 1000)!.id);
    expect(queue.cleanup()).toBe(0);
    now += DAY_MS + 1;
    expect(queue.cleanup()).toBe(1);
  });

  it('caps the retry delay', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
