import type { FileHandle } from 'node:fs/promises';
import { findChild, readPayload, type Box } from './boxes';

export interface TrackFacts {
  width: number;
  height: number;
  rotation: number;
}

const FIXED_16_16 = 0x10000;

async function isVideoTrack(file: FileHandle, trak: Box): Promise<boolean> {
  const mdia = await findChild(file, trak, 'mdia');
  const hdlr = mdia && (await findChild(file, mdia, 'hdlr'));
  const payload = hdlr && (await readPayload(file, hdlr));
  return (
    payload !== undefined && payload.length >= 12 && payload.toString('latin1', 8, 12) === 'vide'
  );
}

/**
 * Reads the rotation in degrees (0, 90, 180 or 270) from a track matrix.
 *
 * @param a - Matrix element a (16.16 fixed point).
 * @param b - Matrix element b (16.16 fixed point).
 * @returns The clockwise rotation, rounded to a quarter turn.
 */
export function matrixRotation(a: number, b: number): number {
  const degrees = (Math.atan2(b / FIXED_16_16, a / FIXED_16_16) * 180) / Math.PI;
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
}

/**
 * Parses a `tkhd` payload: display width and height (16.16) and the matrix rotation.
 *
 * @param payload - The tkhd payload (after the box header).
 * @returns Width, height and rotation, or undefined when the box is short or sizeless.
 */
export function parseTkhd(payload: Buffer): TrackFacts | undefined {
  const matrixAt = payload[0] === 1 ? 52 : 40;
  if (payload.length < matrixAt + 44) return undefined;
  const rotation = matrixRotation(payload.readInt32BE(matrixAt), payload.readInt32BE(matrixAt + 4));
  const width = Math.round(payload.readUInt32BE(matrixAt + 36) / FIXED_16_16);
  const height = Math.round(payload.readUInt32BE(matrixAt + 40) / FIXED_16_16);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height, rotation };
}

/**
 * Reads a `trak` box when it is a video track.
 *
 * @param file - Open file handle.
 * @param trak - The trak box.
 * @returns The track facts, or undefined for audio, text and other tracks.
 */
export async function readVideoTrack(file: FileHandle, trak: Box): Promise<TrackFacts | undefined> {
  if (!(await isVideoTrack(file, trak))) return undefined;
  const tkhd = await findChild(file, trak, 'tkhd');
  const payload = tkhd && (await readPayload(file, tkhd));
  return payload ? parseTkhd(payload) : undefined;
}
