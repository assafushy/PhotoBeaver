import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  defineConnector,
  type ItemRef,
  type SourceContext,
  type SyncBatch,
  type SyncContext,
} from '@photobeaver/plugin-sdk';
import type { LocalConfig } from './config';
import { encodeCursor, resumePoint } from './cursor';
import { changedItems, scanFile, type ScannedFile } from './scan';
import { walkFiles } from './walk';

export type { LocalConfig } from './config';

export const BATCH_SIZE = 500;

async function assertDirectory(root: string | undefined): Promise<string> {
  if (!root) throw new Error('No folder selected');
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Folder not available: ${root}`);
  return root;
}

function assertInsideRoot(ctx: SourceContext<LocalConfig>, item: ItemRef): string {
  const relative = path.relative(ctx.config.root, item.externalId);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`File is outside the source folder: ${item.externalId}`);
  }
  return item.externalId;
}

async function chunkBatch(
  ctx: SyncContext<LocalConfig>,
  files: ScannedFile[],
  scanned: number,
): Promise<SyncBatch> {
  const lastPath = files.at(-1)!.relative;
  return {
    upserts: await changedItems(ctx, files),
    cursor: encodeCursor({ lastPath }),
    progress: { done: scanned, message: lastPath },
  };
}

async function* scanChunks(ctx: SyncContext<LocalConfig>, after: string | null) {
  let chunk: ScannedFile[] = [];
  let scanned = 0;
  for await (const relative of walkFiles(ctx.config.root, after)) {
    ctx.signal.throwIfAborted();
    const file = await scanFile(ctx.config, relative);
    if (!file) continue;
    chunk.push(file);
    scanned++;
    if (chunk.length < BATCH_SIZE) continue;
    yield await chunkBatch(ctx, chunk, scanned);
    chunk = [];
  }
  if (chunk.length > 0) yield await chunkBatch(ctx, chunk, scanned);
}

export default defineConnector<LocalConfig>({
  async setupSource(ctx) {
    const root = await assertDirectory(ctx.config.root);
    return { displayName: path.basename(root) || root };
  },

  async testSource(ctx) {
    await assertDirectory(ctx.config.root);
  },

  async *sync(ctx, cursor) {
    await assertDirectory(ctx.config.root);
    yield* scanChunks(ctx, resumePoint(cursor));
    const completedAt = new Date().toISOString();
    yield { upserts: [], cursor: encodeCursor({ done: true, completedAt }), isFullScan: true };
  },

  async getOriginal(ctx, item) {
    const file = assertInsideRoot(ctx, item);
    return Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  },
});
