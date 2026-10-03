import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Compares two root-relative paths in walk order (segment by segment, by code point).
 *
 * @param a - Slash-separated relative path.
 * @param b - Slash-separated relative path.
 * @returns Negative, zero or positive like a sort comparator.
 */
export function compareWalkOrder(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const result = compare(left[i]!, right[i]!);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

function isAncestor(dir: string, file: string): boolean {
  return file.startsWith(`${dir}/`);
}

async function isFileEntry(entry: Dirent, fullPath: string): Promise<boolean | 'dir'> {
  if (entry.isDirectory()) return 'dir';
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  const target = await stat(fullPath).catch(() => null);
  return target?.isFile() ?? false;
}

async function sortedEntries(dir: string): Promise<Dirent[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => compare(a.name, b.name));
}

function shouldDescend(relative: string, after: string | null): boolean {
  if (after === null || isAncestor(relative, after)) return true;
  return compareWalkOrder(relative, after) > 0;
}

/**
 * Walks a folder depth-first in a stable order, yielding root-relative file paths.
 * Hidden entries and symlinked directories are skipped.
 *
 * @param root - Absolute folder to walk.
 * @param after - Resume point: only paths strictly after it are yielded.
 * @param relativeDir - Internal recursion state.
 * @returns Root-relative, slash-separated file paths.
 */
export async function* walkFiles(
  root: string,
  after: string | null = null,
  relativeDir = '',
): AsyncGenerator<string> {
  for (const entry of await sortedEntries(path.join(root, relativeDir))) {
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const kind = await isFileEntry(entry, path.join(root, relative));
    if (kind === 'dir' && shouldDescend(relative, after)) {
      yield* walkFiles(root, after, relative);
    } else if (kind === true && (after === null || compareWalkOrder(relative, after) > 0)) {
      yield relative;
    }
  }
}
