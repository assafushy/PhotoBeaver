import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * SHA-256 of a file, streamed.
 *
 * @param file - Path of the file.
 * @returns Lowercase hex digest.
 */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Writes a stream to a file while hashing it.
 *
 * @param stream - Bytes to write.
 * @param file - Destination path, replaced if it exists.
 * @param onChunk - Called with each chunk's size after it is written.
 * @returns Lowercase hex SHA-256 of everything written.
 */
export async function writeHashed(
  stream: AsyncIterable<Uint8Array>,
  file: string,
  onChunk?: (bytes: number) => void,
): Promise<string> {
  const hash: Hash = createHash('sha256');
  const handle = await open(file, 'w');
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      await handle.write(chunk);
      onChunk?.(chunk.byteLength);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}
