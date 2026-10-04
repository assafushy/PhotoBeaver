import { unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SyncBatch } from '@photobeaver/plugin-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import connector from '../src';
import { buildBatch } from '../src/watch';
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

  it(
    'reports added and deleted media files in debounced batches',
    { timeout: 30_000 },
    async () => {
      tree = makeTree(['old.jpg']);
      const batches = await watching();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      writeFileSync(path.join(tree.root, 'new.jpg'), 'x');
      writeFileSync(path.join(tree.root, 'notes.txt'), 'x');
      unlinkSync(path.join(tree.root, 'old.jpg'));
      await vi.waitFor(() => expect(batches.flatMap((b) => b.deletes ?? [])).toHaveLength(1), {
        timeout: 25_000,
      });
      const upserted = () => [
        ...new Set(batches.flatMap((b) => b.upserts ?? []).map((i) => i.filename)),
      ];
      await vi.waitFor(() => expect(upserted()).toContain('new.jpg'), { timeout: 25_000 });
      expect(upserted()).not.toContain('notes.txt');
      const deletes = batches.flatMap((b) => b.deletes ?? []);
      expect(deletes).toEqual([path.join(tree.root, 'old.jpg')]);
    },
  );

  it('does not report deletions while the root folder is missing', async () => {
    tree = makeTree(['a.jpg']);
    const pending = { changed: new Set<string>(), removed: new Set(['a.jpg']) };
    expect(await buildBatch({ root: path.join(tree.root, 'unplugged') }, pending)).toBeNull();
    expect((await buildBatch({ root: tree.root }, pending))?.deletes).toEqual([
      path.join(tree.root, 'a.jpg'),
    ]);
  });
});
