import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readGrayPng } from '../src/image/gray';
import { fromHex, hamming, toHex, type Hash64 } from '../src/image/hash64';
import { dHash, pHash } from '../src/image/perceptual';
import { areaTaps, resizeArea } from '../src/image/resize';
import { blobs, render, tempDir, writeJpeg, writeThumbnail } from './helpers';

const temp = tempDir();
afterAll(() => temp.cleanup());

interface Hashes {
  p: Hash64;
  d: Hash64;
}

async function hashesOf(file: string): Promise<Hashes> {
  const image = await readGrayPng(await writeThumbnail(file));
  return { p: pHash(image), d: dHash(image) };
}

const files = {
  original: path.join(temp.dir, 'original.jpg'),
  resized: path.join(temp.dir, 'resized.jpg'),
  reencoded: path.join(temp.dir, 'reencoded.jpg'),
  unrelated: path.join(temp.dir, 'unrelated.jpg'),
};
const hashes: Record<keyof typeof files, Hashes> = {} as never;

beforeAll(async () => {
  const raw = render(blobs(1), 1);
  await writeJpeg(raw, files.original);
  await writeJpeg(raw, files.resized, 85, 300);
  await writeJpeg(raw, files.reencoded, 60);
  await writeJpeg(render(blobs(2), 2), files.unrelated);
  for (const key of Object.keys(files) as (keyof typeof files)[])
    hashes[key] = await hashesOf(files[key]);
});

describe('perceptual hashes', () => {
  it('give distance 0 for the same image', async () => {
    const again = await hashesOf(files.original);
    expect(hamming(again.p, hashes.original.p)).toBe(0);
    expect(hamming(again.d, hashes.original.d)).toBe(0);
  });

  it('stay close for a resized copy', () => {
    expect(hamming(hashes.resized.p, hashes.original.p)).toBeLessThanOrEqual(6);
    expect(hamming(hashes.resized.d, hashes.original.d)).toBeLessThanOrEqual(6);
  });

  it('stay close for a JPEG quality 60 copy', () => {
    expect(hamming(hashes.reencoded.p, hashes.original.p)).toBeLessThanOrEqual(6);
    expect(hamming(hashes.reencoded.d, hashes.original.d)).toBeLessThanOrEqual(6);
  });

  it('are far apart for an unrelated image', () => {
    expect(hamming(hashes.unrelated.p, hashes.original.p)).toBeGreaterThan(16);
    expect(hamming(hashes.unrelated.d, hashes.original.d)).toBeGreaterThan(16);
  });

  it('round-trip through hex', () => {
    const hex = toHex(hashes.original.p);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
    expect(fromHex(hex)).toEqual(hashes.original.p);
    expect(fromHex('xyz')).toBeUndefined();
  });
});

describe('area resize', () => {
  it('weights partial pixels by overlap', () => {
    expect(areaTaps(3, 2)).toEqual([
      [
        { index: 0, weight: 1 },
        { index: 1, weight: 0.5 },
      ],
      [
        { index: 1, weight: 0.5 },
        { index: 2, weight: 1 },
      ],
    ]);
  });

  it('averages blocks', () => {
    const image = { width: 4, height: 2, pixels: Float64Array.from([0, 2, 4, 6, 2, 4, 6, 8]) };
    expect([...resizeArea(image, 2, 1).pixels]).toEqual([2, 6]);
  });
});
