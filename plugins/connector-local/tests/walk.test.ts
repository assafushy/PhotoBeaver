import { afterEach, describe, expect, it } from 'vitest';
import { compareWalkOrder, walkFiles } from '../src/walk';
import { makeTree } from './helpers';

const FILES = [
  'b.jpg',
  'a/2.jpg',
  'a/1.jpg',
  'a/sub/x.jpg',
  'c.png',
  '.hidden/z.jpg',
  'a/.dot.jpg',
];

async function toArray(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('walkFiles', () => {
  let tree: ReturnType<typeof makeTree>;

  afterEach(() => tree.cleanup());

  it('walks depth-first in stable order and skips hidden entries', async () => {
    tree = makeTree(FILES);
    expect(await toArray(walkFiles(tree.root))).toEqual([
      'a/1.jpg',
      'a/2.jpg',
      'a/sub/x.jpg',
      'b.jpg',
      'c.png',
    ]);
  });

  it('resumes strictly after a given path', async () => {
    tree = makeTree(FILES);
    expect(await toArray(walkFiles(tree.root, 'a/2.jpg'))).toEqual([
      'a/sub/x.jpg',
      'b.jpg',
      'c.png',
    ]);
    expect(await toArray(walkFiles(tree.root, 'a/sub/x.jpg'))).toEqual(['b.jpg', 'c.png']);
  });

  it('orders paths the same way the walk does', () => {
    const paths = ['b.jpg', 'a/sub/x.jpg', 'a/2.jpg', 'a/1.jpg'];
    expect([...paths].sort(compareWalkOrder)).toEqual([
      'a/1.jpg',
      'a/2.jpg',
      'a/sub/x.jpg',
      'b.jpg',
    ]);
  });
});
