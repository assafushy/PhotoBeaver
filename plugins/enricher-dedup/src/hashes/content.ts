import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DropboxContentHasher } from './dropbox';
import { QuickXorHasher } from './quickxor';

export interface FullDigest {
  sha256: string;
  dropbox: string;
  quickxor: string;
}

const READ_CHUNK = 1024 * 1024;

/**
 * Reads a file once and computes sha256, the Dropbox content hash and the
 * OneDrive QuickXorHash together.
 *
 * @param file - Path of a local file.
 * @param signal - Aborts the read.
 * @returns The three hashes.
 */
export async function hashFile(file: string, signal?: AbortSignal): Promise<FullDigest> {
  const sha256 = createHash('sha256');
  const dropbox = new DropboxContentHasher();
  const quickxor = new QuickXorHasher();
  const stream = createReadStream(file, { highWaterMark: READ_CHUNK, signal });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    sha256.update(chunk);
    dropbox.update(chunk);
    quickxor.update(chunk);
  }
  return { sha256: sha256.digest('hex'), dropbox: dropbox.digest(), quickxor: quickxor.digest() };
}
