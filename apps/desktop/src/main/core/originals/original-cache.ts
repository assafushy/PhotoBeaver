import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { OriginalSource } from './original-source';

export const DEFAULT_CACHE_CAP_BYTES = 5 * 1024 ** 3;

interface CachedFile {
  file: string;
  size: number;
  mtimeMs: number;
}

/**
 * LRU cache of original files on local disk (SPEC 4.1 `cache/originals/`).
 * Kept behind this interface so a future "archive" store can sit beside it.
 */
export class OriginalCache {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly dir: string,
    private readonly source: OriginalSource,
    private readonly capBytes: number = DEFAULT_CACHE_CAP_BYTES,
  ) {}

  /**
   * Returns a local path to the asset's original, fetching it if needed.
   *
   * @param assetId - Asset id.
   * @param signal - Cancellation signal for the fetch.
   * @returns Absolute path to the cached file.
   */
  async ensureLocal(assetId: string, signal: AbortSignal): Promise<string> {
    const file = this.pathFor(assetId);
    if (await this.touch(file)) return file;
    const pending = this.inFlight.get(assetId) ?? this.fetch(assetId, file, signal);
    this.inFlight.set(assetId, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(assetId);
    }
  }

  /**
   * Removes an asset's cached original (when the asset is deleted).
   *
   * @param assetId - Asset id.
   */
  async evict(assetId: string): Promise<void> {
    await rm(this.pathFor(assetId), { force: true });
  }

  private pathFor(assetId: string): string {
    return path.join(this.dir, assetId);
  }

  private async touch(file: string): Promise<boolean> {
    const now = new Date();
    return utimes(file, now, now).then(
      () => true,
      () => false,
    );
  }

  private async fetch(assetId: string, file: string, signal: AbortSignal): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const stream = await this.source.original({ assetId, signal });
    const temp = `${file}.part`;
    await pipeline(Readable.fromWeb(stream as never), createWriteStream(temp), { signal });
    await rename(temp, file);
    await this.evictOverCap(file);
    return file;
  }

  private async evictOverCap(keep: string): Promise<void> {
    const files = await this.listFiles();
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const entry of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= this.capBytes) return;
      if (entry.file === keep) continue;
      await rm(entry.file, { force: true });
      total -= entry.size;
    }
  }

  private async listFiles(): Promise<CachedFile[]> {
    const names = (await readdir(this.dir)).filter((name) => !name.endsWith('.part'));
    const stats = await Promise.all(
      names.map((name) => stat(path.join(this.dir, name)).catch(() => null)),
    );
    return names.flatMap((name, i) => {
      const s = stats[i];
      return s ? [{ file: path.join(this.dir, name), size: s.size, mtimeMs: s.mtimeMs }] : [];
    });
  }
}
