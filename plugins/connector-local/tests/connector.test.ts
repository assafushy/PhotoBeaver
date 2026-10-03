import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import connector, { BATCH_SIZE } from '../src';
import { collect, fakeSyncContext, makeTree } from './helpers';

describe('connector-local sync', () => {
  let tree: ReturnType<typeof makeTree>;

  afterEach(() => tree.cleanup());

  it('yields media items and ends with a full-scan batch', async () => {
    tree = makeTree(['x/a.jpg', 'b.mov', 'notes.txt']);
    const batches = await collect(connector.sync(fakeSyncContext({ root: tree.root }), null));
    const items = batches.flatMap((b) => b.upserts ?? []);
    expect(items.map((i) => [i.filename, i.kind, i.path])).toEqual([
      ['b.mov', 'video', ''],
      ['a.jpg', 'image', 'x'],
    ]);
    expect(batches.at(-1)).toMatchObject({ upserts: [], isFullScan: true });
    expect(items[1]!.externalUrl).toMatch(/^file:\/\//);
  });

  it('can exclude videos', async () => {
    tree = makeTree(['a.jpg', 'b.mp4']);
    const ctx = fakeSyncContext({ root: tree.root, includeVideos: false });
    const items = (await collect(connector.sync(ctx, null))).flatMap((b) => b.upserts ?? []);
    expect(items.map((i) => i.filename)).toEqual(['a.jpg']);
  });

  it('skips files whose etag core already knows', async () => {
    tree = makeTree(['a.jpg', 'b.jpg']);
    const first = (await collect(connector.sync(fakeSyncContext({ root: tree.root }), null)))[0]!;
    const a = first.upserts![0]!;
    const ctx = fakeSyncContext({ root: tree.root }, { [a.externalId]: { etag: a.etag } });
    const items = (await collect(connector.sync(ctx, null))).flatMap((b) => b.upserts ?? []);
    expect(items.map((i) => i.filename)).toEqual(['b.jpg']);
  });

  it('batches and resumes from the cursor of a committed batch', async () => {
    const files = Array.from(
      { length: BATCH_SIZE + 3 },
      (_, i) => `p${String(i).padStart(4, '0')}.jpg`,
    );
    tree = makeTree(files);
    const ctx = fakeSyncContext({ root: tree.root });
    const batches = await collect(connector.sync(ctx, null));
    expect(batches.map((b) => b.upserts?.length)).toEqual([BATCH_SIZE, 3, 0]);
    const resumed = await collect(connector.sync(ctx, batches[0]!.cursor));
    expect(resumed.flatMap((b) => b.upserts ?? []).map((i) => i.filename)).toEqual(
      files.slice(BATCH_SIZE),
    );
  });

  it('starts a fresh scan after a completed cursor', async () => {
    tree = makeTree(['a.jpg']);
    const ctx = fakeSyncContext({ root: tree.root });
    const done = (await collect(connector.sync(ctx, null))).at(-1)!.cursor;
    const again = await collect(connector.sync(ctx, done));
    expect(again.flatMap((b) => b.upserts ?? [])).toHaveLength(1);
  });

  it('fails without tombstoning when the folder is missing', async () => {
    tree = makeTree([]);
    const ctx = fakeSyncContext({ root: path.join(tree.root, 'gone') });
    await expect(collect(connector.sync(ctx, null))).rejects.toThrow(/not available/);
  });

  it('refuses to stream files outside the root', async () => {
    tree = makeTree(['a.jpg']);
    const ctx = fakeSyncContext({ root: path.join(tree.root, 'sub') });
    const item = { sourceId: 's', externalId: path.join(tree.root, 'a.jpg') };
    await expect(connector.getOriginal(ctx, item)).rejects.toThrow(/outside/);
  });
});
