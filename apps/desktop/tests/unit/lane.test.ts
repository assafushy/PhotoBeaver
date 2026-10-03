import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../../src/main/core/jobs/job-queue';
import { Lane, type JobHandler } from '../../src/main/core/jobs/lane';
import { openTempLibrary, silentLogger, type TempLibrary } from './helpers';

function makeLane(queue: JobQueue, handler: JobHandler, concurrency = 2): Lane {
  return new Lane(
    queue,
    { name: 't', concurrency, handlers: { thumbnail: handler }, idlePollMs: 10 },
    silentLogger,
  );
}

describe('Lane', () => {
  let temp: TempLibrary;
  let queue: JobQueue;

  beforeEach(async () => {
    temp = await openTempLibrary();
    queue = new JobQueue(temp.library.sqlite);
  });

  afterEach(() => temp.cleanup());

  it('runs queued jobs and completes them', async () => {
    const seen: string[] = [];
    const lane = makeLane(queue, async ({ job }) => void seen.push(job.asset_id!));
    queue.onEnqueue(() => lane.wake());
    lane.start();
    queue.enqueue({ kind: 'thumbnail', assetId: 'a' });
    queue.enqueue({ kind: 'thumbnail', assetId: 'b' });
    await vi.waitFor(() => expect(seen.sort()).toEqual(['a', 'b']));
    await vi.waitFor(() => expect(queue.get(2)?.status).toBe('done'));
    await lane.stop(0);
  });

  it('never exceeds its concurrency', async () => {
    let active = 0;
    let peak = 0;
    const lane = makeLane(queue, async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    });
    for (let i = 0; i < 6; i++) queue.enqueue({ kind: 'thumbnail' });
    lane.start();
    await vi.waitFor(() => expect(queue.get(6)?.status).toBe('done'));
    expect(peak).toBe(2);
    await lane.stop(0);
  });

  it('requeues a failing job with backoff', async () => {
    const lane = makeLane(queue, async () => {
      throw new Error('broken');
    });
    queue.enqueue({ kind: 'thumbnail' });
    lane.start();
    await vi.waitFor(() =>
      expect(queue.get(1)).toMatchObject({ status: 'queued', last_error: 'broken' }),
    );
    await lane.stop(0);
  });

  it('leaves in-flight jobs leased on shutdown so they resume next start', async () => {
    const lane = makeLane(
      queue,
      ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    queue.enqueue({ kind: 'thumbnail' });
    lane.start();
    await vi.waitFor(() => expect(queue.get(1)?.status).toBe('leased'));
    await lane.stop(10);
    await new Promise((r) => setTimeout(r, 10));
    expect(queue.get(1)?.status).toBe('leased');
  });

  it('completes a job that was deliberately aborted while running', async () => {
    const lane = makeLane(
      queue,
      ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    queue.enqueue({ kind: 'thumbnail', assetId: 'x' });
    lane.start();
    await vi.waitFor(() => expect(queue.get(1)?.status).toBe('leased'));
    lane.abortWhere((job) => job.asset_id === 'x');
    await vi.waitFor(() => expect(queue.get(1)?.status).toBe('done'));
    await lane.stop(0);
  });
});
