import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes a file atomically (temp file, then rename) creating parent folders.
 *
 * @param target - Final path.
 * @param data - File contents.
 */
export async function writeFileAtomic(target: string, data: Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Reads a web stream fully into a Buffer, refusing streams over a size limit.
 *
 * @param stream - The byte stream.
 * @param maxBytes - Limit before giving up.
 * @returns The bytes.
 */
export async function readStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error(`Stream larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
