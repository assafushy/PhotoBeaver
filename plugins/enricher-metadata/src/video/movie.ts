import type { FileHandle } from 'node:fs/promises';
import type { GeoPoint } from '@photobeaver/plugin-sdk';
import { quickTimeToFloating } from '../floating-time';
import { parseIso6709 } from '../geo';
import { readMetadataKeys, type MetadataKeys } from './apple-keys';
import { childBoxes, findChild, readPayload, type Box } from './boxes';
import { readVideoTrack, type TrackFacts } from './track';

export interface MovieHeader {
  createdAt?: string;
  durationMs?: number;
}

export interface MovieFacts extends MovieHeader {
  track?: TrackFacts;
  xyz?: GeoPoint;
  keys: MetadataKeys;
}

type BoxHandler = (file: FileHandle, box: Box, facts: MovieFacts) => Promise<void>;

const UNKNOWN_DURATION = 0xffffffff;
const XYZ = '©xyz';

function durationMs(duration: number, timescale: number): number | undefined {
  if (timescale <= 0 || duration <= 0 || duration === UNKNOWN_DURATION) return undefined;
  return Math.round((duration * 1000) / timescale);
}

/**
 * Parses an `mvhd` payload: creation time and duration. The creation time is stored as
 * UTC and returned as floating time in the zone of this machine (D41).
 *
 * @param payload - The mvhd payload (after the box header).
 * @returns Creation time as a floating ISO string and duration in milliseconds, when present.
 */
export function parseMvhd(payload: Buffer): MovieHeader {
  const long = payload[0] === 1;
  if (payload.length < (long ? 32 : 20)) return {};
  const created = long ? Number(payload.readBigUInt64BE(4)) : payload.readUInt32BE(4);
  const timescale = payload.readUInt32BE(long ? 20 : 12);
  const duration = long ? Number(payload.readBigUInt64BE(24)) : payload.readUInt32BE(16);
  return { createdAt: quickTimeToFloating(created), durationMs: durationMs(duration, timescale) };
}

/**
 * Parses a QuickTime `©xyz` payload (16-bit length, 16-bit language, ISO 6709 text).
 *
 * @param payload - The ©xyz payload.
 * @returns The location, or undefined.
 */
export function parseXyz(payload: Buffer): GeoPoint | undefined {
  if (payload.length < 4) return undefined;
  const length = payload.readUInt16BE(0);
  return parseIso6709(payload.toString('utf8', 4, Math.min(payload.length, 4 + length)));
}

async function readUdta(file: FileHandle, udta: Box, facts: MovieFacts): Promise<void> {
  const xyz = await findChild(file, udta, XYZ);
  const payload = xyz && (await readPayload(file, xyz));
  facts.xyz ??= payload && parseXyz(payload);
  const meta = await findChild(file, udta, 'meta');
  if (meta) facts.keys = { ...(await readMetadataKeys(file, meta)), ...facts.keys };
}

const HANDLERS: Record<string, BoxHandler> = {
  mvhd: async (file, box, facts) => {
    const payload = await readPayload(file, box);
    if (payload) Object.assign(facts, parseMvhd(payload));
  },
  trak: async (file, box, facts) => {
    facts.track ??= await readVideoTrack(file, box);
  },
  udta: readUdta,
  meta: async (file, box, facts) => {
    facts.keys = { ...facts.keys, ...(await readMetadataKeys(file, box)) };
  },
};

/**
 * Reads movie facts from an ISO base media file (MP4, MOV), box by box. Only the
 * headers of top-level boxes and the small boxes inside `moov` are read.
 *
 * @param file - Open file handle.
 * @returns What was found; empty when there is no `moov` box.
 */
export async function readMovie(file: FileHandle): Promise<MovieFacts> {
  const facts: MovieFacts = { keys: {} };
  const { size } = await file.stat();
  const moov = await findChild(file, { payloadStart: 0, end: size }, 'moov');
  if (!moov) return facts;
  for await (const box of childBoxes(file, moov)) await HANDLERS[box.type]?.(file, box, facts);
  return facts;
}
