import { describe, expect, it } from 'vitest';
import { hamming, type Hash64 } from '../src/image/hash64';
import { BkTree } from '../src/near/bk-tree';
import { random } from './helpers';

function randomHashes(count: number, seed: number): Hash64[] {
  const next = random(seed);
  const base = Array.from({ length: count / 4 }, () => ({
    hi: Math.floor(next() * 2 ** 32),
    lo: Math.floor(next() * 2 ** 32),
  }));
  const flip = (h: Hash64): Hash64 => ({
    hi: (h.hi ^ (1 << Math.floor(next() * 32))) >>> 0,
    lo: (h.lo ^ (1 << Math.floor(next() * 32))) >>> 0,
  });
  return [
    ...base,
    ...base.map(flip),
    ...base.map((h) => flip(flip(h))),
    ...base.slice(0, count / 4),
  ];
}

describe('BK-tree', () => {
  const hashes = randomHashes(800, 42);
  const tree = new BkTree<number>();
  hashes.forEach((hash, i) => tree.insert(hash, i));

  it.each([0, 2, 6, 16, 30])('matches brute force within distance %i', (max) => {
    for (const [i, query] of hashes.slice(0, 50).entries()) {
      const expected = hashes.flatMap((h, j) => (hamming(h, query) <= max ? [j] : []));
      const actual = tree
        .query(query, max)
        .map((m) => m.value)
        .sort((a, b) => a - b);
      expect(actual, `query ${i}`).toEqual(expected);
    }
  });

  it('reports distances', () => {
    const matches = tree.query(hashes[0]!, 64);
    expect(matches).toHaveLength(hashes.length);
    for (const match of matches)
      expect(match.distance).toBe(hamming(hashes[0]!, hashes[match.value]!));
  });

  it('is empty before inserts', () => {
    expect(new BkTree<number>().query({ hi: 0, lo: 0 }, 64)).toEqual([]);
  });
});
