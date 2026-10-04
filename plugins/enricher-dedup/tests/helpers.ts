import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssetView } from '@photobeaver/plugin-sdk';
import type { FakeInputs } from '@photobeaver/plugin-sdk/testing';
import sharp from 'sharp';

export const WIDTH = 640;
export const HEIGHT = 480;
export const THUMB = 256;

export interface Blob {
  x: number;
  y: number;
  r: number;
  color: [number, number, number];
}

/**
 * Deterministic pseudo-random numbers in [0, 1).
 *
 * @param seed - Any integer.
 * @returns A generator.
 */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random coloured discs for a synthetic photo.
 *
 * @param seed - Scene seed.
 * @returns Discs.
 */
export function blobs(seed: number): Blob[] {
  const next = random(seed);
  return Array.from({ length: 12 }, () => ({
    x: next() * WIDTH,
    y: next() * HEIGHT,
    r: 30 + next() * 90,
    color: [next() * 255, next() * 255, next() * 255] as [number, number, number],
  }));
}

function pixel(scene: Blob[], x: number, y: number, seed: number): [number, number, number] {
  let color: [number, number, number] = [(x / WIDTH) * 200 + (seed % 50), (y / HEIGHT) * 200, 120];
  for (const blob of scene)
    if ((x - blob.x) ** 2 + (y - blob.y) ** 2 < blob.r ** 2) color = blob.color;
  return color;
}

/**
 * Renders discs over a gradient as raw RGB.
 *
 * @param scene - Discs.
 * @param seed - Background seed.
 * @returns Raw RGB bytes, WIDTH x HEIGHT.
 */
export function render(scene: Blob[], seed: number): Buffer {
  const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1)
    for (let x = 0; x < WIDTH; x += 1) raw.set(pixel(scene, x, y, seed), (y * WIDTH + x) * 3);
  return raw;
}

/**
 * Writes raw RGB as a JPEG.
 *
 * @param raw - Raw RGB bytes, WIDTH x HEIGHT.
 * @param file - Output path.
 * @param quality - JPEG quality.
 * @param width - Optional output width (resized copy).
 */
export async function writeJpeg(
  raw: Buffer,
  file: string,
  quality = 92,
  width?: number,
): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  let image = sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });
  if (width) image = image.resize({ width });
  await image.jpeg({ quality }).toFile(file);
}

/**
 * Writes a 256 px PNG thumbnail of an image file, as core would hand out.
 *
 * @param file - Source image.
 * @returns Path of the PNG thumbnail.
 */
export async function writeThumbnail(file: string): Promise<string> {
  const out = `${file}.thumb.png`;
  await sharp(file).resize({ width: THUMB, height: THUMB, fit: 'inside' }).png().toFile(out);
  return out;
}

/**
 * Creates a temporary folder.
 *
 * @returns The folder and a cleanup function.
 */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-dedup-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface FixtureAsset {
  asset: AssetView;
  inputs: FakeInputs;
}

/**
 * Builds an asset view and its fake inputs for a file on disk.
 *
 * @param id - Asset id.
 * @param file - Original file.
 * @param extra - Asset overrides (kind, capturedAt, instance hash) and thumbnail path.
 * @returns The asset and its inputs.
 */
export function fixtureAsset(
  id: string,
  file: string,
  extra: Partial<AssetView> & { thumbnail?: string } = {},
): FixtureAsset {
  const { thumbnail, ...overrides } = extra;
  const asset: AssetView = {
    id,
    kind: 'image',
    mime: 'image/jpeg',
    instances: [{ sourceId: 'local', path: file, sizeBytes: statSync(file).size }],
    enrichments: {},
    ...overrides,
  };
  return { asset, inputs: { original: file, thumbnail, png: thumbnail, mime: asset.mime } };
}
