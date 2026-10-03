import { schema } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobQueue } from '../../src/main/core/jobs/job-queue';
import { Scheduler } from '../../src/main/core/scheduler/scheduler';
import { sourceState } from '../../src/main/core/scheduler/source-state';
import {
  ERROR_THRESHOLD,
  failureDelayMs,
  successDelayMs,
} from '../../src/main/core/scheduler/timing';
import { insertPlugin, insertSource, openTempLibrary, type TempLibrary } from './helpers';

describe('scheduler timing', () => {
  it('adds 0 to 10% jitter on success', () => {
    expect(successDelayMs(3600, 0)).toBe(3_600_000);
    expect(successDelayMs(3600, 0.999)).toBeLessThan(3_960_000);
    expect(successDelayMs(3600, 0.999)).toBeGreaterThan(3_959_000);
  });

  it('backs off exponentially, never above the interval or 6 hours', () => {
    expect(failureDelayMs(3600, 0)).toBe(60_000);
    expect(failureDelayMs(3600, 3)).toBe(480_000);
    expect(failureDelayMs(3600, 9)).toBe(3_600_000);
    expect(failureDelayMs(86_400, 20)).toBe(6 * 3_600_000);
  });
});

describe('Scheduler', () => {
  let temp: TempLibrary;
  let now: number;
  let queue: JobQueue;
  let scheduler: Scheduler;

  const source = (id: string) =>
    temp.library.db.select().from(schema.sources).where(eq(schema.sources.id, id)).get()!;

  beforeEach(async () => {
    temp = await openTempLibrary();
    now = 10_000_000;
    queue = new JobQueue(temp.library.sqlite, () => now);
    scheduler = new Scheduler(temp.library.db, queue, () => now);
    insertPlugin(temp, 'p');
  });

  afterEach(() => temp.cleanup());

  it('queues due poll sources once and marks them queued', () => {
    insertSource(temp, { id: 'due', pluginId: 'p', nextRunAt: now });
    insertSource(temp, { id: 'later', pluginId: 'p', nextRunAt: now + 1 });
    insertSource(temp, { id: 'manual', pluginId: 'p', nextRunAt: 0, mode: 'manual' });
    insertSource(temp, { id: 'paused', pluginId: 'p', nextRunAt: 0, syncState: 'paused' });
    expect(scheduler.tick()).toEqual(['due']);
    expect(source('due').syncState).toBe('queued');
    expect(scheduler.tick()).toEqual([]);
  });

  it('skips sources of disabled or crashed plugins', () => {
    insertPlugin(temp, 'off', { enabled: 0 });
    insertPlugin(temp, 'bad', { health: 'crashed' });
    insertSource(temp, { id: 'a', pluginId: 'off', nextRunAt: 0 });
    insertSource(temp, { id: 'b', pluginId: 'bad', nextRunAt: 0 });
    expect(scheduler.tick()).toEqual([]);
  });

  it('records success, failure, auth and rate-limit outcomes', () => {
    insertSource(temp, { id: 's', pluginId: 'p', nextRunAt: 0 });
    sourceState.failed(temp.library.db, source('s'), now, new Error('net down'));
    expect(source('s')).toMatchObject({
      syncState: 'idle',
      consecutiveFailures: 1,
      nextRunAt: now + 60_000,
    });
    sourceState.succeeded(temp.library.db, source('s'), now, 0);
    expect(source('s')).toMatchObject({
      syncState: 'idle',
      consecutiveFailures: 0,
      nextRunAt: now + 3_600_000,
    });
    sourceState.rateLimited(temp.library.db, 's', now, 30);
    expect(source('s')).toMatchObject({ consecutiveFailures: 0, nextRunAt: now + 30_000 });
    sourceState.authRequired(temp.library.db, 's', now, new Error('expired'));
    expect(source('s').syncState).toBe('auth_required');
  });

  it('enters the error state after 10 consecutive failures and keeps polling', () => {
    insertSource(temp, { id: 's', pluginId: 'p', nextRunAt: 0 });
    for (let i = 0; i < ERROR_THRESHOLD; i++)
      sourceState.failed(temp.library.db, source('s'), now, 'x');
    expect(source('s').syncState).toBe('error');
    now = source('s').nextRunAt!;
    expect(scheduler.tick()).toEqual(['s']);
  });

  it('reconciles states left by a crash', () => {
    insertSource(temp, { id: 'orphan', pluginId: 'p', syncState: 'running' });
    insertSource(temp, { id: 'kept', pluginId: 'p', syncState: 'running' });
    scheduler.syncNow('kept', 'p');
    temp.library.db
      .update(schema.sources)
      .set({ syncState: 'running' })
      .where(eq(schema.sources.id, 'kept'))
      .run();
    scheduler.reconcile();
    expect(source('orphan').syncState).toBe('idle');
    expect(source('kept').syncState).toBe('queued');
  });
});
