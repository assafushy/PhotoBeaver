import type { FileHandle } from 'node:fs/promises';

export const MAX_PAYLOAD_BYTES = 1 << 20;

export interface BoxRange {
  payloadStart: number;
  end: number;
}

export interface Box extends BoxRange {
  type: string;
  start: number;
}

/**
 * Reads up to `length` bytes at `position`.
 *
 * @param file - Open file handle.
 * @param position - Byte offset.
 * @param length - Number of bytes wanted.
 * @returns The bytes read, shorter at the end of the file.
 */
export async function readBytes(file: FileHandle, position: number, length: number) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

function boxSize(head: Buffer, remaining: number): { size: number; headerSize: number } {
  const size32 = head.readUInt32BE(0);
  if (size32 === 0) return { size: remaining, headerSize: 8 };
  if (size32 !== 1) return { size: size32, headerSize: 8 };
  if (head.length < 16) return { size: 0, headerSize: 16 };
  return { size: Number(head.readBigUInt64BE(8)), headerSize: 16 };
}

async function readHeader(file: FileHandle, start: number, end: number): Promise<Box | undefined> {
  if (end - start < 8) return undefined;
  const head = await readBytes(file, start, Math.min(16, end - start));
  if (head.length < 8) return undefined;
  const { size, headerSize } = boxSize(head, end - start);
  if (size < headerSize || start + size > end) return undefined;
  const type = head.toString('latin1', 4, 8);
  return { type, start, payloadStart: start + headerSize, end: start + size };
}

/**
 * Walks the boxes inside a range one header at a time, without reading their payloads.
 * Stops at the first malformed or truncated box.
 *
 * @param file - Open file handle.
 * @param range - The parent's payload (or the whole file).
 * @yields Each child box.
 */
export async function* childBoxes(file: FileHandle, range: BoxRange): AsyncGenerator<Box> {
  let offset = range.payloadStart;
  while (offset < range.end) {
    const box = await readHeader(file, offset, range.end);
    if (!box) return;
    yield box;
    offset = box.end;
  }
}

/**
 * Finds the first child box of a type.
 *
 * @param file - Open file handle.
 * @param range - The parent's payload.
 * @param type - Four-character box type.
 * @returns The box, or undefined.
 */
export async function findChild(file: FileHandle, range: BoxRange, type: string) {
  for await (const box of childBoxes(file, range)) if (box.type === type) return box;
  return undefined;
}

/**
 * Reads a box payload, refusing payloads over MAX_PAYLOAD_BYTES.
 *
 * @param file - Open file handle.
 * @param box - The box.
 * @returns The payload, or undefined when it is too large.
 */
export async function readPayload(file: FileHandle, box: BoxRange): Promise<Buffer | undefined> {
  const length = box.end - box.payloadStart;
  if (length > MAX_PAYLOAD_BYTES) return undefined;
  return readBytes(file, box.payloadStart, length);
}
