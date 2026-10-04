import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipInput {
  name: string;
  data?: Uint8Array | string;
  method?: 0 | 8;
  dataDescriptor?: boolean;
  utf8?: boolean;
  encrypted?: boolean;
  modifiedAt?: Date;
  unixTime?: Date;
}

export interface ZipOptions {
  zip64?: boolean;
}

interface Prepared {
  input: ZipInput;
  name: Buffer;
  crc: number;
  size: number;
  body: Buffer;
  flags: number;
  offset: number;
}

const MAX_U32 = 0xffffffff;

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function extraField(id: number, body: Buffer): Buffer {
  return Buffer.concat([u16(id), u16(body.length), body]);
}

function dosDateTime(date: Date): Buffer {
  const time =
    (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day =
    ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return Buffer.concat([u16(time), u16(day)]);
}

function prepare(input: ZipInput): Prepared {
  const raw = Buffer.from(input.data ?? '');
  const body = input.method === 8 ? deflateRawSync(raw) : raw;
  const flags =
    (input.utf8 ? 0x0800 : 0) | (input.dataDescriptor ? 0x08 : 0) | (input.encrypted ? 1 : 0);
  const name = Buffer.from(input.name, input.utf8 ? 'utf8' : 'latin1');
  return { input, name, crc: crc32(raw), size: raw.length, body, flags, offset: 0 };
}

function timeExtra(entry: Prepared): Buffer {
  const time = entry.input.unixTime;
  if (!time) return Buffer.alloc(0);
  const seconds = Buffer.alloc(4);
  seconds.writeInt32LE(Math.floor(time.getTime() / 1000));
  return extraField(0x5455, Buffer.concat([Buffer.from([1]), seconds]));
}

function commonFields(entry: Prepared, zip64: boolean, inLocal: boolean): Buffer {
  const hidden = inLocal && entry.input.dataDescriptor;
  const sizes = zip64
    ? [u32(MAX_U32), u32(MAX_U32)]
    : [u32(hidden ? 0 : entry.body.length), u32(hidden ? 0 : entry.size)];
  return Buffer.concat([
    u16(entry.flags),
    u16(entry.input.method ?? 0),
    dosDateTime(entry.input.modifiedAt ?? new Date(Date.UTC(2020, 0, 2, 3, 4, 6))),
    u32(hidden ? 0 : entry.crc),
    ...sizes,
    u16(entry.name.length),
  ]);
}

function localHeader(entry: Prepared, zip64: boolean): Buffer {
  const extra = zip64
    ? extraField(1, Buffer.concat([u64(entry.size), u64(entry.body.length)]))
    : Buffer.alloc(0);
  const fields = commonFields(entry, zip64, true);
  return Buffer.concat([u32(0x04034b50), u16(45), fields, u16(extra.length), entry.name, extra]);
}

function dataDescriptor(entry: Prepared): Buffer {
  if (!entry.input.dataDescriptor) return Buffer.alloc(0);
  return Buffer.concat([u32(0x08074b50), u32(entry.crc), u32(entry.body.length), u32(entry.size)]);
}

function centralHeader(entry: Prepared, zip64: boolean): Buffer {
  const zip64Extra = zip64
    ? extraField(1, Buffer.concat([u64(entry.size), u64(entry.body.length), u64(entry.offset)]))
    : Buffer.alloc(0);
  const extra = Buffer.concat([zip64Extra, timeExtra(entry)]);
  return Buffer.concat([
    u32(0x02014b50),
    u16(0x031e),
    u16(45),
    commonFields(entry, zip64, false),
    u16(extra.length),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(zip64 ? MAX_U32 : entry.offset),
    entry.name,
    extra,
  ]);
}

function zip64Trailer(count: number, size: number, offset: number): Buffer {
  const record = Buffer.concat([
    u32(0x06064b50),
    u64(44),
    u16(45),
    u16(45),
    u32(0),
    u32(0),
    u64(count),
    u64(count),
    u64(size),
    u64(offset),
  ]);
  const locator = Buffer.concat([u32(0x07064b50), u32(0), u64(offset + size), u32(1)]);
  return Buffer.concat([record, locator]);
}

function endOfCentralDirectory(count: number, size: number, offset: number, zip64: boolean) {
  const trailer = zip64 ? zip64Trailer(count, size, offset) : Buffer.alloc(0);
  const fields = zip64
    ? [u16(0xffff), u16(0xffff), u32(MAX_U32), u32(MAX_U32)]
    : [u16(count), u16(count), u32(size), u32(offset)];
  return Buffer.concat([trailer, u32(0x06054b50), u16(0), u16(0), ...fields, u16(0)]);
}

/**
 * Builds a zip archive in memory for tests.
 *
 * @param inputs - Entries in stored order.
 * @param options - `zip64` forces ZIP64 records even for small files.
 * @returns The zip file bytes.
 */
export function writeZip(inputs: ZipInput[], options: ZipOptions = {}): Buffer {
  const zip64 = options.zip64 ?? false;
  const parts: Buffer[] = [];
  let offset = 0;
  const entries = inputs.map(prepare);
  for (const entry of entries) {
    entry.offset = offset;
    const chunk = Buffer.concat([localHeader(entry, zip64), entry.body, dataDescriptor(entry)]);
    parts.push(chunk);
    offset += chunk.length;
  }
  const central = Buffer.concat(entries.map((entry) => centralHeader(entry, zip64)));
  parts.push(central, endOfCentralDirectory(entries.length, central.length, offset, zip64));
  return Buffer.concat(parts);
}
