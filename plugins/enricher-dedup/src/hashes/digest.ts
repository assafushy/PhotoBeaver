import { stat } from 'node:fs/promises';
import { ALGO, KEY_PREFIX, srcKey } from '../keys';
import { hashFile } from './content';
import { sampleHash } from './vsample';

export interface ContentDigest {
  size: number;
  sha256?: string;
  dropbox?: string;
  quickxor?: string;
  vsample?: string;
}

/**
 * Hashes a local original: full hashes, or the sampled hash for large videos.
 *
 * @param file - Path of the original.
 * @param sampled - Use the sampled hash instead of reading the whole file.
 * @param signal - Aborts the read.
 * @returns The digest with the file size.
 */
export async function digestFile(
  file: string,
  sampled: boolean,
  signal?: AbortSignal,
): Promise<ContentDigest> {
  const { size } = await stat(file);
  if (sampled) return { size, vsample: await sampleHash(file) };
  return { size, ...(await hashFile(file, signal)) };
}

/**
 * The identity keys a digest publishes.
 *
 * @param digest - Content digest.
 * @returns `sha256:`, `src:dropbox:` and `src:quickxor:` keys, or one `vsample:` key.
 */
export function digestKeys(digest: ContentDigest): string[] {
  if (digest.vsample) return [`${KEY_PREFIX.vsample}${digest.vsample}`];
  return [
    `${KEY_PREFIX.sha256}${digest.sha256}`,
    srcKey(ALGO.dropbox, digest.dropbox!),
    srcKey(ALGO.quickxor, digest.quickxor!),
  ];
}

/**
 * The value two digests are compared on.
 *
 * @param digest - Content digest.
 * @param sampled - Whether the comparison uses sampled hashes.
 * @returns The sha256 or sampled hash, if present.
 */
export function comparable(
  digest: Pick<ContentDigest, 'sha256' | 'vsample'>,
  sampled: boolean,
): string | undefined {
  return sampled ? digest.vsample : digest.sha256;
}
