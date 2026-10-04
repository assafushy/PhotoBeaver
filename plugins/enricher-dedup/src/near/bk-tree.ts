import { hamming, type Hash64 } from '../image/hash64';

interface BkNode<T> {
  hash: Hash64;
  values: T[];
  children: Map<number, BkNode<T>>;
}

export interface BkMatch<T> {
  value: T;
  distance: number;
  node: number;
}

/**
 * A BK-tree over 64-bit hashes with Hamming distance, for "all hashes within
 * distance d" queries without comparing every pair.
 */
export class BkTree<T> {
  private root: BkNode<T> | undefined;

  /**
   * Adds a value under a hash. Values with equal hashes share a node.
   *
   * @param hash - The hash.
   * @param value - Value returned by queries.
   */
  insert(hash: Hash64, value: T): void {
    if (!this.root) {
      this.root = newNode(hash, value);
      return;
    }
    let node = this.root;
    for (;;) {
      const distance = hamming(hash, node.hash);
      if (distance === 0) return void node.values.push(value);
      const child = node.children.get(distance);
      if (!child) return void node.children.set(distance, newNode(hash, value));
      node = child;
    }
  }

  /**
   * Finds every value whose hash is within `maxDistance` of `hash`.
   *
   * @param hash - Query hash.
   * @param maxDistance - Largest Hamming distance to include.
   * @param perNodeLimit - Most values taken from one node (values sharing a hash), in insertion order.
   * @returns Matches with their distance and the (per query) number of the node they share.
   */
  query(hash: Hash64, maxDistance: number, perNodeLimit = Infinity): BkMatch<T>[] {
    const matches: BkMatch<T>[] = [];
    let visited = 0;
    const stack = this.root ? [this.root] : [];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const distance = hamming(hash, node.hash);
      visited += 1;
      if (distance <= maxDistance)
        for (const value of node.values.slice(0, perNodeLimit))
          matches.push({ value, distance, node: visited });
      for (const [edge, child] of node.children)
        if (Math.abs(edge - distance) <= maxDistance) stack.push(child);
    }
    return matches;
  }
}

function newNode<T>(hash: Hash64, value: T): BkNode<T> {
  return { hash, values: [value], children: new Map() };
}
