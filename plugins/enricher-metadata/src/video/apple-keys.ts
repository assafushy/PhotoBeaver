import type { FileHandle } from 'node:fs/promises';
import { childBoxes, findChild, readBytes, readPayload, type Box, type BoxRange } from './boxes';

export type MetadataKeys = Record<string, string>;

const UTF8_TYPES = new Set([1, 4]);

/**
 * Parses a `keys` payload into key names by 1-based index.
 *
 * @param payload - The keys payload (version, flags, count, entries).
 * @returns Key names, index 0 unused.
 */
export function parseKeys(payload: Buffer): string[] {
  const names: string[] = [''];
  let offset = 8;
  while (offset + 8 <= payload.length) {
    const size = payload.readUInt32BE(offset);
    if (size < 8 || offset + size > payload.length) break;
    names.push(payload.toString('utf8', offset + 8, offset + size));
    offset += size;
  }
  return names;
}

/**
 * Reads the text value of an `ilst` item's `data` box.
 *
 * @param payload - The data payload (type, locale, value).
 * @returns The UTF-8 value, or undefined for binary values.
 */
export function parseDataValue(payload: Buffer): string | undefined {
  if (payload.length < 8) return undefined;
  const type = payload.readUInt32BE(0) & 0xffffff;
  return UTF8_TYPES.has(type) ? payload.toString('utf8', 8).replace(/\0+$/, '') : undefined;
}

async function metaChildren(file: FileHandle, meta: Box): Promise<BoxRange> {
  const peek = await readBytes(file, meta.payloadStart, 8);
  const isFullBox = peek.length === 8 && peek.toString('latin1', 4, 8) !== 'hdlr';
  return { payloadStart: meta.payloadStart + (isFullBox ? 4 : 0), end: meta.end };
}

async function readItem(file: FileHandle, item: Box): Promise<string | undefined> {
  const data = await findChild(file, item, 'data');
  const payload = data && (await readPayload(file, data));
  return payload ? parseDataValue(payload) : undefined;
}

async function readItems(file: FileHandle, ilst: Box, names: string[]): Promise<MetadataKeys> {
  const values: MetadataKeys = {};
  for await (const item of childBoxes(file, ilst)) {
    const name = names[Buffer.from(item.type, 'latin1').readUInt32BE(0)];
    const value = name ? await readItem(file, item) : undefined;
    if (name && value !== undefined) values[name] = value;
  }
  return values;
}

/**
 * Reads QuickTime metadata keys (`meta` with `keys` and `ilst`), such as
 * `com.apple.quicktime.location.ISO6709` and `com.apple.quicktime.creationdate`.
 *
 * @param file - Open file handle.
 * @param meta - The meta box (QuickTime style or ISO full box).
 * @returns Text values by key name.
 */
export async function readMetadataKeys(file: FileHandle, meta: Box): Promise<MetadataKeys> {
  const range = await metaChildren(file, meta);
  const keys = await findChild(file, range, 'keys');
  const ilst = await findChild(file, range, 'ilst');
  const keysPayload = keys && (await readPayload(file, keys));
  if (!keysPayload || !ilst) return {};
  return readItems(file, ilst, parseKeys(keysPayload));
}
