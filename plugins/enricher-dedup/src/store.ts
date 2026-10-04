import path from 'node:path';
import { appendJsonLines, readJsonLines, writeJsonLines } from './jsonl';

export interface NearEntry {
  assetId: string;
  phash: string;
  capturedAt?: string;
}

export interface ContentEntry {
  assetId: string;
  size: number;
  sha256?: string;
  vsample?: string;
}

export const MAX_GROUP_SIZE = 50;

const FILES = {
  near: 'near-index.jsonl',
  content: 'content-hashes.jsonl',
  suggested: 'suggested-groups.jsonl',
} as const;

function lastPerAsset<T extends { assetId: string }>(entries: T[]): Map<string, T> {
  return new Map(entries.map((entry) => [entry.assetId, entry]));
}

/**
 * Asset to pHash and capture time index kept in the plugin's data folder.
 */
export const nearIndex = {
  append: (dataDir: string, entry: NearEntry) =>
    appendJsonLines(path.join(dataDir, FILES.near), [entry]),
  load: async (dataDir: string) =>
    lastPerAsset(await readJsonLines<NearEntry>(path.join(dataDir, FILES.near))),
  rewrite: (dataDir: string, entries: NearEntry[]) =>
    writeJsonLines(path.join(dataDir, FILES.near), entries),
};

/**
 * Content hashes this plugin computed, so candidates are hashed at most once per size.
 */
export const contentCache = {
  append: (dataDir: string, entry: ContentEntry) =>
    appendJsonLines(path.join(dataDir, FILES.content), [entry]),
  load: async (dataDir: string) =>
    lastPerAsset(await readJsonLines<ContentEntry>(path.join(dataDir, FILES.content))),
};

/**
 * Groups of assets already suggested to the user (sorted ids), so dismissed
 * suggestions are not repeated and grown clusters only show their new members.
 */
export class SuggestedMemory {
  private readonly keys: Set<string>;
  private readonly groupsOf = new Map<string, Set<number>>();

  /**
   * @param groups - Previously suggested groups.
   */
  constructor(groups: string[][]) {
    this.keys = new Set(groups.map(groupKey));
    groups.forEach((group, index) => {
      for (const id of group)
        this.groupsOf.set(id, (this.groupsOf.get(id) ?? new Set()).add(index));
    });
  }

  /**
   * @param id - Asset id.
   * @returns True when the asset was part of any suggestion.
   */
  isMember(id: string): boolean {
    return this.groupsOf.has(id);
  }

  /**
   * @param a - One asset id.
   * @param b - The other asset id.
   * @returns True when both assets were suggested in the same group.
   */
  together(a: string, b: string): boolean {
    const groups = this.groupsOf.get(b);
    return [...(this.groupsOf.get(a) ?? [])].some((index) => groups?.has(index));
  }

  /**
   * @param ids - Asset ids in any order.
   * @returns True when exactly this group was suggested before.
   */
  has(ids: string[]): boolean {
    return this.keys.has(groupKey(ids));
  }
}

function groupKey(ids: string[]): string {
  return [...ids].sort().join('|');
}

/**
 * Persistence for suggested groups, as JSON lines of sorted id arrays.
 */
export const suggestedGroups = {
  append: (dataDir: string, groups: string[][]) =>
    appendJsonLines(
      path.join(dataDir, FILES.suggested),
      groups.map((group) => [...group].sort()),
    ),
  load: async (dataDir: string) =>
    new SuggestedMemory(await readJsonLines<string[]>(path.join(dataDir, FILES.suggested))),
};
