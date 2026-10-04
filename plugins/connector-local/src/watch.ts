import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MediaItem, SyncBatch, SyncContext, Unsubscribe } from '@photobeaver/plugin-sdk';
import { watch as watchFolder } from 'chokidar';
import type { LocalConfig } from './config';
import { scanFile } from './scan';

export const WATCH_DEBOUNCE_MS = 500;
export const WATCH_CURSOR = 'watch';

export interface Pending {
  changed: Set<string>;
  removed: Set<string>;
}

const isHidden = (file: string, root: string): boolean =>
  path
    .relative(root, file)
    .split(path.sep)
    .some((part) => part.startsWith('.'));

const toRelative = (root: string, file: string): string =>
  path.relative(root, file).split(path.sep).join('/');

async function rootExists(root: string): Promise<boolean> {
  const info = await stat(root).catch(() => null);
  return Boolean(info?.isDirectory());
}

/**
 * Turns pending file events into a batch. Deletions are dropped while the root
 * folder is missing, so an unplugged drive does not empty the library.
 *
 * @param config - Source config.
 * @param pending - Root-relative paths changed and removed.
 * @returns The batch, or null when there is nothing to report.
 */
export async function buildBatch(config: LocalConfig, pending: Pending): Promise<SyncBatch | null> {
  const scanned = await Promise.all([...pending.changed].map((rel) => scanFile(config, rel)));
  const upserts: MediaItem[] = scanned.flatMap((file) => (file ? [file.item] : []));
  const online = await rootExists(config.root);
  const deletes = online
    ? [...pending.removed].map((rel) => path.join(config.root, ...rel.split('/')))
    : [];
  if (upserts.length === 0 && deletes.length === 0) return null;
  return { upserts, deletes, cursor: WATCH_CURSOR };
}

function createDebouncer(flush: () => void): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ((timer = null), flush()), WATCH_DEBOUNCE_MS);
  };
}

function createFlush(
  ctx: SyncContext<LocalConfig>,
  pending: Pending,
  onChange: (batch: SyncBatch) => void,
): () => Promise<void> {
  return async () => {
    const batch = await buildBatch(ctx.config, {
      changed: new Set(pending.changed),
      removed: new Set(pending.removed),
    });
    pending.changed.clear();
    pending.removed.clear();
    if (batch) onChange(batch);
  };
}

function createRecorder(root: string, pending: Pending, schedule: () => void) {
  return (set: keyof Pending) => (file: string) => {
    pending[set].add(toRelative(root, file));
    pending[set === 'changed' ? 'removed' : 'changed'].delete(toRelative(root, file));
    schedule();
  };
}

function startWatcher(
  ctx: SyncContext<LocalConfig>,
  root: string,
  schedule: () => void,
  pending: Pending,
) {
  const watcher = watchFolder(root, {
    ignoreInitial: true,
    ignored: (file) => isHidden(file, root),
    awaitWriteFinish: { stabilityThreshold: 300 },
  });
  const record = createRecorder(root, pending, schedule);
  watcher
    .on('add', record('changed'))
    .on('change', record('changed'))
    .on('unlink', record('removed'));
  watcher.on('error', (error) => ctx.log.warn('Folder watch error', { error: String(error) }));
  return watcher;
}

/**
 * Push-based change detection for a local folder (SPEC 9.2): file events are
 * debounced into batches. The real (symlink-resolved) folder is watched, and
 * paths are reported relative to it, so they map back to the configured root. Deletions are dropped while the root folder is
 * missing, so an unplugged drive does not empty the library.
 *
 * @param ctx - Sync context (config, logger).
 * @param onChange - Receives each batch.
 * @returns Stops watching.
 */
export async function watchLocalFolder(
  ctx: SyncContext<LocalConfig>,
  onChange: (batch: SyncBatch) => void,
): Promise<Unsubscribe> {
  const pending: Pending = { changed: new Set(), removed: new Set() };
  const flush = createFlush(ctx, pending, onChange);
  const schedule = createDebouncer(
    () =>
      void flush().catch((error) => ctx.log.warn('Watch batch failed', { error: String(error) })),
  );
  const root = await realpath(ctx.config.root).catch(() => ctx.config.root);
  const watcher = startWatcher(ctx, root, schedule, pending);
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  return () => void watcher.close();
}
