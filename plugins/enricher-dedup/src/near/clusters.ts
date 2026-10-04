import { MAX_GROUP_SIZE, type SuggestedMemory } from '../store';
import type { NearPair } from './pairs';

export interface Cluster {
  ids: string[];
  edges: NearPair[];
  maxDistance: number;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(id: string): string {
    let node = id;
    for (;;) {
      const parent = this.parent.get(node) ?? node;
      if (parent === node) return node;
      const grand = this.parent.get(parent) ?? parent;
      this.parent.set(node, grand);
      node = grand;
    }
  }

  union(a: string, b: string): void {
    const [low, high] = [this.find(a), this.find(b)].sort() as [string, string];
    if (low !== high) this.parent.set(high, low);
  }
}

function addEdge(clusters: Map<string, Cluster>, root: string, pair: NearPair): void {
  const cluster = clusters.get(root) ?? { ids: [], edges: [], maxDistance: 0 };
  cluster.ids.push(pair.a, pair.b);
  cluster.edges.push(pair);
  cluster.maxDistance = Math.max(cluster.maxDistance, pair.distance);
  clusters.set(root, cluster);
}

/**
 * Connected components of the near-duplicate graph (union-find).
 *
 * @param pairs - Qualifying pairs (the graph's edges).
 * @returns Components with sorted ids, their edges and largest edge distance.
 */
export function clusters(pairs: NearPair[]): Cluster[] {
  const sets = new UnionFind();
  for (const pair of pairs) sets.union(pair.a, pair.b);
  const byRoot = new Map<string, Cluster>();
  for (const pair of pairs) addEdge(byRoot, sets.find(pair.a), pair);
  return [...byRoot.values()]
    .map((cluster) => ({ ...cluster, ids: [...new Set(cluster.ids)].sort() }))
    .sort((x, y) => (x.ids[0]! < y.ids[0]! ? -1 : 1));
}

/**
 * Splits ids into the fewest chunks of at most `max`, with sizes as even as
 * possible so no chunk is a lone asset.
 *
 * @param ids - Ids in the order to keep.
 * @param max - Largest chunk size.
 * @returns Chunks.
 */
export function balancedChunks(ids: string[], max: number): string[][] {
  const count = Math.ceil(ids.length / max);
  const chunks: string[][] = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const size = Math.floor(ids.length / count) + (i < ids.length % count ? 1 : 0);
    chunks.push(ids.slice(start, start + size));
    start += size;
  }
  return chunks;
}

function anchorFor(cluster: Cluster, fresh: Set<string>): string {
  const linked = cluster.edges.flatMap((edge) => {
    if (fresh.has(edge.a) !== fresh.has(edge.b)) return [fresh.has(edge.a) ? edge.b : edge.a];
    return [];
  });
  return linked.sort()[0] ?? cluster.ids.find((id) => !fresh.has(id))!;
}

/**
 * The groups to suggest for a component: the whole component (in chunks of at
 * most 50) when all of it is new, only its new members plus one existing member
 * they connect to when it grew, and nothing when every member was suggested before.
 *
 * @param cluster - A connected component.
 * @param memory - Groups suggested before.
 * @returns Groups of sorted asset ids.
 */
export function planGroups(cluster: Cluster, memory: SuggestedMemory): string[][] {
  const fresh = cluster.ids.filter((id) => !memory.isMember(id));
  if (fresh.length === 0) return [];
  if (fresh.length === cluster.ids.length)
    return balancedChunks(cluster.ids, MAX_GROUP_SIZE).filter((group) => !memory.has(group));
  const anchor = anchorFor(cluster, new Set(fresh));
  return balancedChunks(fresh, MAX_GROUP_SIZE - 1).map((chunk) => [anchor, ...chunk].sort());
}
