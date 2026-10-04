import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';

export const SAMPLE_BYTES = 1024 * 1024;
export const VIDEO_SAMPLE_THRESHOLD = 200 * 1024 * 1024;

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/**
 * Start offsets of the first, middle and last sample of a file.
 *
 * @param size - File size in bytes.
 * @returns Three offsets (they may overlap for small files).
 */
export function sampleOffsets(size: number): number[] {
  const last = Math.max(0, size - SAMPLE_BYTES);
  return [0, Math.floor(last / 2), last];
}

/**
 * A sampled hash for very large videos: sha256 over the size and the first,
 * middle and last 1 MiB. Equal values mean "very likely the same file".
 *
 * @param file - Path of a local file.
 * @returns The sampled hash as lowercase hex.
 */
export async function sampleHash(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const hash = createHash('sha256').update(`${size}\n`);
    for (const offset of sampleOffsets(size))
      hash.update(await readAt(handle, offset, SAMPLE_BYTES));
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/**
 * Whether an asset of this kind and size uses the sampled hash instead of full hashes.
 *
 * @param kind - Asset kind.
 * @param size - Largest known size in bytes.
 * @param threshold - Size above which videos are sampled.
 * @returns True for videos over the threshold.
 */
export function usesSampledHash(
  kind: string,
  size: number,
  threshold = VIDEO_SAMPLE_THRESHOLD,
): boolean {
  return kind === 'video' && size > threshold;
}
