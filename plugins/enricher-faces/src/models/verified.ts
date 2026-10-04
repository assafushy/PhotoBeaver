import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256File } from './hash';
import type { ModelFile } from './source';

interface VerifiedEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
}

type VerifiedCache = Record<string, VerifiedEntry>;

const CACHE_FILE = 'verified.json';

async function readCache(dir: string): Promise<VerifiedCache> {
  try {
    return JSON.parse(await readFile(path.join(dir, CACHE_FILE), 'utf8')) as VerifiedCache;
  } catch {
    return {};
  }
}

async function statOrUndefined(
  file: string,
): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const info = await stat(file);
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records that a model file has the expected hash, keyed by its size and modification time.
 *
 * @param dir - Models folder.
 * @param file - The verified model file.
 */
export async function markVerified(dir: string, file: ModelFile): Promise<void> {
  const info = await statOrUndefined(path.join(dir, file.name));
  if (!info) return;
  const cache = await readCache(dir);
  cache[file.name] = { ...info, sha256: file.sha256 };
  await writeFile(path.join(dir, CACHE_FILE), JSON.stringify(cache, null, 2));
}

/**
 * Checks a model file against its expected hash. Uses the cached result when size
 * and modification time are unchanged, so large models are not rehashed on every start.
 *
 * @param dir - Models folder.
 * @param file - Expected file name and hash.
 * @returns True when the file exists and matches.
 */
export async function isVerified(dir: string, file: ModelFile): Promise<boolean> {
  const info = await statOrUndefined(path.join(dir, file.name));
  if (!info) return false;
  const cached = (await readCache(dir))[file.name];
  const unchanged = cached?.size === info.size && cached.mtimeMs === info.mtimeMs;
  if (unchanged && cached.sha256 === file.sha256) return true;
  if ((await sha256File(path.join(dir, file.name))) !== file.sha256) return false;
  await markVerified(dir, file);
  return true;
}
