import { openArchive } from './open-archive';
import type { ArchiveTree } from './types';

export const ARCHIVE_IDLE_CLOSE_MS = 60_000;

interface Shared {
  tree: Promise<ArchiveTree>;
  users: number;
  timer?: ReturnType<typeof setTimeout>;
}

const shared = new Map<string, Shared>();

function acquire(root: string): Shared {
  const existing = shared.get(root);
  if (existing) return (clearTimeout(existing.timer), existing.users++, existing);
  const entry: Shared = { tree: openArchive(root), users: 1 };
  shared.set(root, entry);
  entry.tree.catch(() => shared.delete(root));
  return entry;
}

function closeTree(entry: Shared): void {
  void entry.tree.then((tree) => tree.close()).catch(() => undefined);
}

function release(root: string, entry: Shared, idleMs: number): void {
  entry.users--;
  if (entry.users > 0) return;
  if (shared.get(root) !== entry) return closeTree(entry);
  entry.timer = setTimeout(() => (shared.delete(root), closeTree(entry)), idleMs);
  entry.timer.unref?.();
}

function evict(root: string, entry: Shared): void {
  if (shared.get(root) === entry) shared.delete(root);
}

function once(action: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    action();
  };
}

async function pump(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  finish: () => void,
): Promise<void> {
  try {
    const { done, value } = await reader.read();
    if (!done) return controller.enqueue(value);
    finish();
    controller.close();
  } catch (error) {
    finish();
    controller.error(error);
  }
}

function releasingStream(
  source: ReadableStream<Uint8Array>,
  finish: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    pull: (controller) => pump(reader, controller, finish),
    cancel: (reason) => reader.cancel(reason).finally(finish),
  });
}

async function streamFrom(root: string, path: string, idleMs: number) {
  const entry = acquire(root);
  const finish = once(() => release(root, entry, idleMs));
  try {
    const tree = await entry.tree;
    if (!tree.has(path)) return (evict(root, entry), finish(), null);
    return releasingStream(await tree.open(path), finish);
  } catch (error) {
    finish();
    throw error;
  }
}

/**
 * Streams one file out of an export (for `getOriginal`). Open archives are shared
 * between calls and closed after a minute without use, so generating thousands of
 * thumbnails does not re-read every zip's central directory each time. A path the
 * shared listing doesn't know reopens the export once, in case it changed.
 *
 * @param root - Export folder (or .zip), as passed to `openArchive`.
 * @param path - The entry's path inside the export.
 * @param idleMs - How long an unused archive stays open.
 * @returns A web stream of the entry's bytes.
 * @throws Error when the path is not in the export.
 */
export async function openArchiveEntry(
  root: string,
  path: string,
  idleMs = ARCHIVE_IDLE_CLOSE_MS,
): Promise<ReadableStream<Uint8Array>> {
  const stream = (await streamFrom(root, path, idleMs)) ?? (await streamFrom(root, path, idleMs));
  if (!stream) throw new Error(`${path} is not in the export`);
  return stream;
}

/**
 * Closes every shared archive now, for example in a plugin's `deactivate`.
 */
export async function closeSharedArchives(): Promise<void> {
  const entries = [...shared.values()];
  shared.clear();
  entries.forEach((entry) => clearTimeout(entry.timer));
  await Promise.all(
    entries.map((entry) => entry.tree.then((tree) => tree.close()).catch(() => undefined)),
  );
}
