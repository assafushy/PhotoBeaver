import { open, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { normalizeEntryPath } from './paths';
import {
  EOCD_SIZE,
  FLAG_ENCRYPTED,
  LOCAL_HEADER_SIZE,
  LOCAL_SIG,
  MAX_COMMENT,
  ZIP64_EOCD_SIZE,
  ZIP64_LOCATOR_SIZE,
  findEocd,
  parseCentralDirectory,
  parseEocd,
  parseZip64Eocd,
  parseZip64Locator,
  type CentralDirectory,
  type ZipRecord,
} from './zip-format';

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export interface ZipMember extends ZipRecord {
  path: string;
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(Math.max(0, length));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
  return buffer.subarray(0, bytesRead);
}

async function locateCentralDirectory(handle: FileHandle): Promise<CentralDirectory> {
  const fileSize = (await handle.stat()).size;
  const tailStart = Math.max(0, fileSize - EOCD_SIZE - MAX_COMMENT);
  const tail = await readAt(handle, tailStart, fileSize - tailStart);
  const index = findEocd(tail);
  if (index < 0) throw new Error('No end of central directory record');
  const eocdOffset = tailStart + index;
  const locatorOffset = eocdOffset - ZIP64_LOCATOR_SIZE;
  const locator = locatorOffset < 0 ? undefined : await readAt(handle, locatorOffset, 20);
  const zip64Offset = locator && parseZip64Locator(locator);
  if (zip64Offset === undefined) return parseEocd(tail, index);
  return parseZip64Eocd(await readAt(handle, zip64Offset, ZIP64_EOCD_SIZE));
}

function toMember(record: ZipRecord): ZipMember | undefined {
  if (record.name.endsWith('/') || record.flags & FLAG_ENCRYPTED) return undefined;
  if (record.method !== METHOD_STORED && record.method !== METHOD_DEFLATE) return undefined;
  const path = normalizeEntryPath(record.name);
  return path === undefined ? undefined : { ...record, path };
}

async function readMembers(handle: FileHandle): Promise<ZipMember[]> {
  const directory = await locateCentralDirectory(handle);
  const buffer = await readAt(handle, directory.offset, directory.size);
  return parseCentralDirectory(buffer).flatMap((record) => toMember(record) ?? []);
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
}

/** A zip file opened for random access. Only the central directory is read up front. */
export class ZipFile {
  private constructor(
    readonly path: string,
    private readonly handle: FileHandle,
    readonly members: ZipMember[],
  ) {}

  /**
   * Opens a zip file and reads its central directory.
   *
   * @param path - Absolute path of the zip file.
   * @returns The open zip. Call `close()` when done.
   */
  static async open(path: string): Promise<ZipFile> {
    const handle = await open(path, 'r');
    try {
      return new ZipFile(path, handle, await readMembers(handle));
    } catch (error) {
      await handle.close();
      throw new Error(`Cannot read zip file ${path}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  /**
   * Streams one member's uncompressed bytes from its local header.
   *
   * @param member - A member of this zip.
   * @returns A web stream of the member's contents.
   */
  async openMember(member: ZipMember): Promise<ReadableStream<Uint8Array>> {
    const start = await this.dataOffset(member);
    if (member.compressedSize === 0) return emptyStream();
    const end = start + member.compressedSize - 1;
    const raw = this.handle.createReadStream({ start, end, autoClose: false });
    const source = member.method === METHOD_DEFLATE ? raw.pipe(createInflateRaw()) : raw;
    if (source !== raw) raw.on('error', (error) => source.destroy(error));
    return Readable.toWeb(source) as ReadableStream<Uint8Array>;
  }

  /** Closes the file handle. */
  async close(): Promise<void> {
    await this.handle.close();
  }

  private async dataOffset(member: ZipMember): Promise<number> {
    const header = await readAt(this.handle, member.localOffset, LOCAL_HEADER_SIZE);
    if (header.length < LOCAL_HEADER_SIZE || header.readUInt32LE(0) !== LOCAL_SIG) {
      throw new Error(`Corrupt local header for ${member.path} in ${this.path}`);
    }
    return (
      member.localOffset + LOCAL_HEADER_SIZE + header.readUInt16LE(26) + header.readUInt16LE(28)
    );
  }
}
