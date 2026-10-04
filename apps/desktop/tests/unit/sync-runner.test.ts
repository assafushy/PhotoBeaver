import { schema } from '@photobeaver/db';
import { AuthRequiredError } from '@photobeaver/plugin-sdk';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../../src/main/core/connectors/registry';
import { nullEventSink } from '../../src/main/core/events/event-sink';
import { JobQueue } from '../../src/main/core/jobs/job-queue';
import type { JobRow } from '../../src/main/core/jobs/job-types';
import { BatchWriter } from '../../src/main/core/sync/batch-writer';
import { SyncRunner } from '../../src/main/core/sync/sync-runner';
import { queryLibraryPage } from '../../src/main/library/library-service';
import { fakeConnector, type FakeSource } from './fake-connector';
import {
  insertSource,
  openTempLibrary,
  silentCoreLog,
  testRegistryDeps,
  type TempLibrary,
} from './helpers';

const files = (n: number, etag = 'v1') =>
  Array.from({ length: n }, (_, i) => ({ id: `f${String(i).padStart(3, '0')}`, etag }));

describe('SyncRunner', () => {
  let temp: TempLibrary;
  let state: FakeSource;
  let queue: JobQueue;
  let runner: SyncRunner;

  const db = () => temp.library.db;
  const source = () => db().select().from(schema.sources).where(eq(schema.sources.id, 's')).get()!;
  const liveCount = () => queryLibraryPage(db(), { cursor: null, limit: 1000 }).total;
  const thumbJobs = () =>
    db().select().from(schema.jobs).where(eq(schema.jobs.kind, 'thumbnail')).all().length;
  const runSync = () =>
    runner.run({ job: { source_id: 's' } as JobRow, signal: new AbortController().signal });

  beforeEach(async () => {
    temp = await openTempLibrary();
    state = { files: files(5), batchSize: 2 };
    const entry = fakeConnector(state);
    const registry = new ConnectorRegistry([entry], testRegistryDeps(temp, temp.dir));
    registry.registerBuiltins(0);
    insertSource(temp, { id: 's', pluginId: 'fake' });
    queue = new JobQueue(temp.library.sqlite);
    runner = new SyncRunner({
      db: db(),
      writer: new BatchWriter(db(), queue),
      registry,
      events: nullEventSink,
      logger: silentCoreLog,
      random: () => 0,
    });
  });

  afterEach(() => temp.cleanup());

  it('creates one asset per new instance, queues thumbnails and records success', async () => {
    await runSync();
    expect(source().lastError).toBeNull();
    expect(liveCount()).toBe(5);
    expect(thumbJobs()).toBe(5);
    expect(source()).toMatchObject({
      syncState: 'idle',
      syncCursor: 'done',
      syncRunId: null,
      consecutiveFailures: 0,
    });
  });

  it('skips unchanged items and re-thumbnails changed ones', async () => {
    await runSync();
    db().delete(schema.jobs).run();
    state.files[1]!.etag = 'v2';
    await runSync();
    expect(liveCount()).toBe(5);
    expect(thumbJobs()).toBe(1);
  });

  it('tombstones files missing from a full scan and hides their assets', async () => {
    await runSync();
    state.files.splice(0, 2);
    await runSync();
    expect(liveCount()).toBe(3);
    const missing = db()
      .select()
      .from(schema.assets)
      .all()
      .filter((a) => a.missingSince !== null);
    expect(missing).toHaveLength(2);
  });

  it('brings a deleted file back when it reappears', async () => {
    await runSync();
    const removed = state.files.shift()!;
    await runSync();
    state.files.unshift(removed);
    await runSync();
    expect(liveCount()).toBe(5);
    expect(db().select().from(schema.assets).all()).toHaveLength(5);
  });

  it('keeps items a connector skipped via isKnown', async () => {
    state.useIsKnown = true;
    await runSync();
    await runSync();
    expect(liveCount()).toBe(5);
  });

  it('resumes after a crash with the same run and ends in the same state', async () => {
    state.useIsKnown = true;
    state.failAfterBatches = 1;
    await runSync();
    const crashed = source();
    expect(crashed).toMatchObject({ syncCursor: '2', consecutiveFailures: 1 });
    expect(crashed.syncRunId).not.toBeNull();
    state.failAfterBatches = undefined;
    await runSync();
    expect(liveCount()).toBe(5);
    expect(db().select().from(schema.instances).all()).toHaveLength(5);
    expect(source()).toMatchObject({ syncCursor: 'done', syncRunId: null });
  });

  it('moves the source to auth_required on AuthRequiredError', async () => {
    state.failAfterBatches = 0;
    state.failWith = new AuthRequiredError();
    await runSync();
    expect(source().syncState).toBe('auth_required');
  });
});
