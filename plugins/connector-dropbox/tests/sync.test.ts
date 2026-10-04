import { describe, expect, it } from 'vitest';
import type { SyncBatch } from '@photobeaver/plugin-sdk';
import { createFakeSyncContext, runSync } from '@photobeaver/plugin-sdk/testing';
import connector, { type DropboxConfig } from '../src';
import type { FakeDropbox } from './fake-dropbox';
import { collect, contextFor, seededDropbox } from './helpers';

function syncContext(fake: FakeDropbox) {
  return createFakeSyncContext<DropboxConfig>({}, contextFor(fake));
}

async function fullThenChanges(fake: FakeDropbox, change: () => void) {
  const ctx = syncContext(fake);
  const full = await collect(connector.sync(ctx, null));
  change();
  const changes = await collect(connector.sync(ctx, full.at(-1)!.cursor));
  return { ctx, full, changes };
}

const upserted = (batches: SyncBatch[]) => batches.flatMap((b) => b.upserts ?? []);
const deleted = (batches: SyncBatch[]) => batches.flatMap((b) => b.deletes ?? []);

describe('sync', () => {
  it('pages a full scan and marks only the last batch as a full scan', async () => {
    const fake = seededDropbox();
    const ctx = syncContext(fake);
    const batches = await collect(connector.sync(ctx, null));
    expect(batches.length).toBeGreaterThan(2);
    expect(batches.map((b) => b.isFullScan === true)).toEqual(
      batches.map((_, i) => i === batches.length - 1),
    );
    expect(ctx.recorded.progress.length).toBe(batches.length);
    const first = JSON.parse(fake.requests[0]!.body!) as Record<string, unknown>;
    expect(first).toEqual({ path: '', recursive: true, include_deleted: false, limit: 500 });
  });

  it('lists only new and changed files after a full scan', async () => {
    const fake = seededDropbox();
    const beach = [...fake.files.values()].find((f) => f.path.endsWith('beach.jpg'))!;
    const { changes } = await fullThenChanges(fake, () => {
      fake.addFile('/Photos/new.jpg');
      fake.updateFile(beach.id, 'edited');
    });
    expect(upserted(changes).map((i) => i.filename)).toEqual(['new.jpg', 'beach.jpg']);
    expect(upserted(changes)[1]!.etag).toBe(beach.rev);
    expect(changes.some((b) => b.isFullScan)).toBe(false);
  });

  it('turns a deleted file path into its id', async () => {
    const fake = seededDropbox();
    let removed: string[] = [];
    const { changes } = await fullThenChanges(fake, () => {
      removed = fake.removePath('/Photos/2024/BEACH.jpg');
    });
    expect(removed).toHaveLength(1);
    expect(deleted(changes)).toEqual(removed);
  });

  it('deletes every known file under a deleted folder', async () => {
    const fake = seededDropbox();
    let removed: string[] = [];
    const { changes } = await fullThenChanges(fake, () => {
      removed = fake.removePath('/Photos/2025');
    });
    expect(deleted(changes).sort()).toEqual(removed.sort());
    expect(removed).toHaveLength(2);
  });

  it('keeps a moved file instead of deleting it', async () => {
    const fake = seededDropbox();
    const top = [...fake.files.values()].find((f) => f.path === '/top.webp')!;
    const { changes } = await fullThenChanges(fake, () => fake.moveFile(top.id, '/Moved/top.webp'));
    expect(deleted(changes)).toEqual([]);
    expect(upserted(changes)).toMatchObject([{ externalId: top.id, path: '/Moved' }]);
  });

  it('restarts with a full scan when Dropbox resets the cursor', async () => {
    const fake = seededDropbox();
    const { changes, ctx } = await fullThenChanges(fake, () => fake.resetCursors());
    expect(changes.at(-1)!.isFullScan).toBe(true);
    expect(upserted(changes)).toHaveLength(7);
    expect(ctx.recorded.logs.some((l) => l.msg.includes('reset'))).toBe(true);
  });

  it('skips files whose rev is already known during a full scan', async () => {
    const fake = seededDropbox();
    const first = await runSync(connector, { config: {}, context: contextFor(fake) });
    const known = Object.fromEntries(first.items.map((i) => [i.externalId, { etag: i.etag }]));
    const [one] = first.items;
    fake.updateFile(one!.externalId, 'changed');
    const again = await runSync(connector, { config: {}, known, context: contextFor(fake) });
    expect(again.items.map((i) => i.externalId)).toEqual([one!.externalId]);
  });

  it('stops when the sync is cancelled', async () => {
    const fake = seededDropbox();
    const controller = new AbortController();
    const ctx = createFakeSyncContext<DropboxConfig>(
      {},
      contextFor(fake, { signal: controller.signal }),
    );
    const iterator = connector.sync(ctx, null)[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toThrow();
  });
});
