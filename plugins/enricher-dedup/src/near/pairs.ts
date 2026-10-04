import type { Hash64 } from '../image/hash64';
import type { NearEntry } from '../store';
import { BkTree, type BkMatch } from './bk-tree';

export const BURST_WINDOW_MS = 2000;
export const NEAREST_PER_ASSET = 20;

export interface HashedAsset {
  assetId: string;
  hash: Hash64;
}

export interface NearPair {
  a: string;
  b: string;
  distance: number;
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nearest(
  tree: BkTree<string>,
  item: HashedAsset,
  maxDistance: number,
  limit: number,
): BkMatch<string>[] {
  const sorted = tree
    .query(item.hash, maxDistance, limit + 1)
    .filter((match) => match.value !== item.assetId)
    .sort((x, y) => x.distance - y.distance || byText(x.value, y.value));
  const top = sorted.slice(0, limit);
  const reached = new Set(top.map((match) => match.node));
  const bridges = sorted.filter((match) => !reached.has(match.node) && reached.add(match.node));
  return [...top, ...bridges];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function keepBest(best: Map<string, NearPair>, a: string, b: string, distance: number): void {
  const key = pairKey(a, b);
  if ((best.get(key)?.distance ?? Infinity) <= distance) return;
  const [first, second] = key.split('|') as [string, string];
  best.set(key, { a: first, b: second, distance });
}

/**
 * Pairs of distinct assets within `maxDistance`, looking at each asset's `limit`
 * nearest neighbours plus one neighbour per other matching hash (so groups stay
 * connected), which keeps huge groups of identical images near-linear.
 * The smallest distance wins when an asset has several hashes (after a merge).
 *
 * @param hashed - Asset hashes.
 * @param maxDistance - Largest Hamming distance to include.
 * @param limit - Neighbours examined per asset.
 * @returns Pairs with `a < b`, in a deterministic order.
 */
export function nearPairs(
  hashed: HashedAsset[],
  maxDistance: number,
  limit = NEAREST_PER_ASSET,
): NearPair[] {
  const sorted = [...hashed].sort((x, y) => byText(x.assetId, y.assetId));
  const tree = new BkTree<string>();
  for (const item of sorted) tree.insert(item.hash, item.assetId);
  const best = new Map<string, NearPair>();
  for (const item of sorted)
    for (const match of nearest(tree, item, maxDistance, limit))
      keepBest(best, item.assetId, match.value, match.distance);
  return [...best.values()].sort((x, y) => byText(x.a, y.a) || byText(x.b, y.b));
}

/**
 * Whether two look-alike shots are a burst (taken under 2 seconds apart and
 * not pixel-identical), which must not be suggested (SPEC 9.4 step 6).
 *
 * @param pair - The pair and its distance.
 * @param index - Capture times by asset id.
 * @returns True for burst shots.
 */
export function isBurst(pair: NearPair, index: Map<string, NearEntry>): boolean {
  const a = Date.parse(index.get(pair.a)?.capturedAt ?? '');
  const b = Date.parse(index.get(pair.b)?.capturedAt ?? '');
  if (Number.isNaN(a) || Number.isNaN(b) || pair.distance === 0) return false;
  return Math.abs(a - b) < BURST_WINDOW_MS;
}
