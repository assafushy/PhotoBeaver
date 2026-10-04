import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@photobeaver/plugin-sdk';
import { downloadFile } from './download';
import { extractModels } from './extract';
import { modelFiles, type ModelSource, type RetryPolicy } from './source';
import { isVerified, markVerified } from './verified';

export interface EnsureContext {
  dataDir: string;
  fetch: typeof fetch;
  log: Logger;
  status(text: string | null): void;
  signal: AbortSignal;
}

const DOWNLOAD_FILE = 'models-download.zip';

/**
 * Folder holding the model files inside the plugin's data folder.
 *
 * @param dataDir - The plugin's data folder.
 * @returns The models folder.
 */
export function modelsDir(dataDir: string): string {
  return path.join(dataDir, 'models');
}

async function allVerified(dir: string, source: ModelSource): Promise<boolean> {
  for (const file of modelFiles(source)) if (!(await isVerified(dir, file))) return false;
  return true;
}

async function downloadAndExtract(
  ctx: EnsureContext,
  source: ModelSource,
  dir: string,
): Promise<void> {
  const zip = path.join(ctx.dataDir, DOWNLOAD_FILE);
  try {
    const hash = await downloadFile(source.url, zip, ctx);
    if (hash !== source.sha256)
      throw new Error('Model archive does not match its expected SHA-256');
    ctx.status('Unpacking face models');
    await extractModels(zip, modelFiles(source), dir);
    for (const file of modelFiles(source)) await markVerified(dir, file);
  } finally {
    await rm(zip, { force: true });
  }
}

/**
 * Makes sure both model files are present and verified, downloading and
 * extracting the archive when they are not. One attempt, no retries.
 *
 * @param ctx - Data folder, fetch, logger, status sink and abort signal.
 * @param source - Where the models come from and their hashes.
 * @returns The models folder.
 */
export async function prepareModels(ctx: EnsureContext, source: ModelSource): Promise<string> {
  const dir = modelsDir(ctx.dataDir);
  await mkdir(dir, { recursive: true });
  if (await allVerified(dir, source)) return dir;
  ctx.log.info('Downloading face models', { url: source.url });
  await downloadAndExtract(ctx, source, dir);
  ctx.log.info('Face models ready');
  return dir;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort(): void {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Retries `prepareModels` with exponential backoff until it succeeds or the
 * signal aborts. Clears the status line when the models are ready.
 *
 * @param ctx - Data folder, fetch, logger, status sink and abort signal.
 * @param source - Where the models come from and their hashes.
 * @param retry - Backoff delays.
 * @returns The models folder.
 * @throws The abort reason when the signal aborts.
 */
export async function ensureModels(
  ctx: EnsureContext,
  source: ModelSource,
  retry: RetryPolicy,
): Promise<string> {
  for (let delay = retry.initialDelayMs; ; delay = Math.min(delay * 2, retry.maxDelayMs)) {
    try {
      const dir = await prepareModels(ctx, source);
      ctx.status(null);
      return dir;
    } catch (error) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      ctx.log.warn('Face model download failed', { error: String(error), retryInMs: delay });
      ctx.status('Model download failed, retrying');
      await sleep(delay, ctx.signal);
    }
  }
}
