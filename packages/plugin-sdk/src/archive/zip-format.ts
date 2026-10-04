const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;
const ZIP64_EXTRA_ID = 0x0001;
const EXTENDED_TIME_ID = 0x5455;
const MAX_U32 = 0xffffffff;
const FLAG_UTF8 = 0x0800;

export const EOCD_SIZE = 22;
export const MAX_COMMENT = 0xffff;
export const ZIP64_LOCATOR_SIZE = 20;
export const ZIP64_EOCD_SIZE = 56;
export const LOCAL_HEADER_SIZE = 30;
export const LOCAL_SIG = 0x04034b50;
export const FLAG_ENCRYPTED = 0x0001;

export interface CentralDirectory {
  offset: number;
  size: number;
}

export interface ZipSizes {
  size: number;
  compressedSize: number;
  localOffset: number;
}

export interface ZipRecord extends ZipSizes {
  name: string;
  flags: number;
  method: number;
  modifiedAt: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Finds the End Of Central Directory record by scanning backwards.
 *
 * @param tail - The last bytes of the zip file.
 * @returns The record's index in `tail`, or -1.
 */
export function findEocd(tail: Buffer): number {
  for (let index = tail.length - EOCD_SIZE; index >= 0; index--) {
    if (tail.readUInt32LE(index) === EOCD_SIG) return index;
  }
  return -1;
}

/**
 * Reads the central directory location from a classic EOCD record.
 *
 * @param tail - Buffer holding the record.
 * @param index - Record start in `tail`.
 * @returns Central directory offset and size.
 */
export function parseEocd(tail: Buffer, index: number): CentralDirectory {
  return { size: tail.readUInt32LE(index + 12), offset: tail.readUInt32LE(index + 16) };
}

/**
 * Reads the ZIP64 EOCD record offset from a ZIP64 locator.
 *
 * @param locator - The 20 bytes before the classic EOCD.
 * @returns The ZIP64 EOCD offset, or undefined when there is no locator.
 */
export function parseZip64Locator(locator: Buffer): number | undefined {
  if (locator.length < ZIP64_LOCATOR_SIZE || locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) {
    return undefined;
  }
  return Number(locator.readBigUInt64LE(8));
}

/**
 * Reads the central directory location from a ZIP64 EOCD record.
 *
 * @param record - The ZIP64 EOCD record bytes.
 * @returns Central directory offset and size.
 */
export function parseZip64Eocd(record: Buffer): CentralDirectory {
  if (record.length < ZIP64_EOCD_SIZE || record.readUInt32LE(0) !== ZIP64_EOCD_SIG) {
    throw new Error('Corrupt ZIP64 end of central directory');
  }
  return { size: Number(record.readBigUInt64LE(40)), offset: Number(record.readBigUInt64LE(48)) };
}

/**
 * Parses every central directory header.
 *
 * @param buffer - The whole central directory.
 * @returns One record per header, in stored order.
 */
export function parseCentralDirectory(buffer: Buffer): ZipRecord[] {
  const records: ZipRecord[] = [];
  let offset = 0;
  while (
    offset + CENTRAL_HEADER_SIZE <= buffer.length &&
    buffer.readUInt32LE(offset) === CENTRAL_SIG
  ) {
    const parsed = parseCentralHeader(buffer, offset);
    records.push(parsed.record);
    offset += parsed.length;
  }
  return records;
}

function readRawSizes(buffer: Buffer, offset: number): ZipSizes {
  return {
    compressedSize: buffer.readUInt32LE(offset + 20),
    size: buffer.readUInt32LE(offset + 24),
    localOffset: buffer.readUInt32LE(offset + 42),
  };
}

function parseCentralHeader(buffer: Buffer, offset: number) {
  const nameStart = offset + CENTRAL_HEADER_SIZE;
  const extraStart = nameStart + buffer.readUInt16LE(offset + 28);
  const extraEnd = extraStart + buffer.readUInt16LE(offset + 30);
  const extra = buffer.subarray(extraStart, extraEnd);
  const flags = buffer.readUInt16LE(offset + 8);
  const record: ZipRecord = {
    name: decodeName(buffer.subarray(nameStart, extraStart), flags),
    flags,
    method: buffer.readUInt16LE(offset + 10),
    ...applyZip64(readRawSizes(buffer, offset), extra),
    modifiedAt: entryTime(
      extra,
      buffer.readUInt16LE(offset + 14),
      buffer.readUInt16LE(offset + 12),
    ),
  };
  return { record, length: extraEnd - offset + buffer.readUInt16LE(offset + 32) };
}

function decodeName(bytes: Buffer, flags: number): string {
  if (flags & FLAG_UTF8) return bytes.toString('utf8');
  try {
    return utf8.decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

function findExtra(extra: Buffer, id: number): Buffer | undefined {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const size = extra.readUInt16LE(offset + 2);
    if (extra.readUInt16LE(offset) === id) return extra.subarray(offset + 4, offset + 4 + size);
    offset += 4 + size;
  }
  return undefined;
}

function applyZip64(raw: ZipSizes, extra: Buffer): ZipSizes {
  const field = findExtra(extra, ZIP64_EXTRA_ID);
  if (!field) return raw;
  let cursor = 0;
  const next = (value: number): number => {
    if (value !== MAX_U32 || cursor + 8 > field.length) return value;
    cursor += 8;
    return Number(field.readBigUInt64LE(cursor - 8));
  };
  const size = next(raw.size);
  const compressedSize = next(raw.compressedSize);
  return { size, compressedSize, localOffset: next(raw.localOffset) };
}

function entryTime(extra: Buffer, date: number, time: number): string {
  const field = findExtra(extra, EXTENDED_TIME_ID);
  const hasModified = field !== undefined && field.length >= 5 && ((field[0] ?? 0) & 1) === 1;
  if (hasModified) return new Date(field.readInt32LE(1) * 1000).toISOString();
  return dosTime(date, time);
}

function dosTime(date: number, time: number): string {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = ((date >> 5) & 0x0f) - 1;
  const seconds = (time & 0x1f) * 2;
  const utc = Date.UTC(year, month, date & 0x1f, (time >> 11) & 0x1f, (time >> 5) & 0x3f, seconds);
  return new Date(utc).toISOString();
}
