import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SyncBatch } from '@photobeaver/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import connector from '../src';
import { fakeSyncContext, makeTree } from './helpers';

describe('connector-local watch', () => {
  let tree: ReturnType<typeof makeTree>;
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    tree.cleanup();
  });

  async function watching() {
    const batches: SyncBatch[] = [];
    stop = await connector.watch!(fakeSyncContext({ root: tree.root }), (b) => batches.push(b));
    return batches;
  }

  it('reports added and deleted media files in debounced batches', async () => {
    tree = makeTree(['old.jpg']);
    const batches = await watching();
    writeFileSync(path.join(tree.root, 'new.jpg'), 'x');
    writeFileSync(path.join(tree.root, 'notes.txt'), 'x');
    unlinkSync(path.join(tree.root, 'old.jpg'));
    await vi.waitFor(() => expect(batches.length).toBeGreaterThan(0), { timeout: 5000 });
    const upserts = batches.flatMap((b) => b.upserts ?? []).map((i) => i.filename);
    const deletes = batches.flatMap((b) => b.deletes ?? []);
    expect(upserts).toEqual(['new.jpg']);
    expect(deletes).toEqual([path.join(tree.root, 'old.jpg')]);
  });

  it('does not report deletions while the root folder is missing', async () => {
    tree = makeTree(['sub/a.jpg']);
    const root = tree.root;
    mkdirSync(path.join(root, 'sub', 'keep'), { recursive: true });
    const batches = await watching();
    renameSync(root, `${root}-unplugged`);
    await new Promise((r) => setTimeout(r, 1500));
    renameSync(`${root}-unplugged`, root);
    expect(batches.flatMap((b) => b.deletes ?? [])).toEqual([]);
  });
});
