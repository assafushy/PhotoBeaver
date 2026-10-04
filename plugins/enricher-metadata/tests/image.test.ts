import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, enrichFile } from './helpers';
import { makeFixtureDir, writeParisJpeg, writePlainPng } from './fixtures';
import plugin from '../src';

const fixtures = makeFixtureDir();
const jpeg = fixtures.file('paris.jpg');
const png = fixtures.file('plain.png');

describe('photos', () => {
  beforeAll(async () => {
    await writeParisJpeg(jpeg);
    await writePlainPng(png);
  });
  afterAll(() => fixtures.cleanup());

  it('reads floating capture time, ignoring OffsetTimeOriginal', async () => {
    const { result } = await enrichFile(jpeg, 'image/jpeg');
    expect(result.capturedAt).toBe('2023-05-01T14:22:33.250Z');
  });

  it('reads the GPS position', async () => {
    const { result } = await enrichFile(jpeg, 'image/jpeg');
    expect(result.location?.lat).toBeCloseTo(48.8584, 4);
    expect(result.location?.lon).toBeCloseTo(2.2945, 4);
  });

  it('swaps dimensions for orientation 6', async () => {
    const { result } = await enrichFile(jpeg, 'image/jpeg');
    expect(result.dimensions).toEqual({ width: 32, height: 64 });
  });

  it('keeps camera fields and search text', async () => {
    const { result } = await enrichFile(jpeg, 'image/jpeg');
    expect(result.data).toEqual({
      exif: {
        make: 'Canon',
        model: 'Canon EOS R5',
        lens: 'RF50mm F1.8 STM',
        fNumber: 2.8,
        exposureTime: 0.004,
        iso: 200,
        focalLength: 50,
        orientation: 6,
        software: 'Beaver 1.0',
        offsetTime: '+02:00',
      },
    });
    expect(result.searchText).toBe('Canon EOS R5');
  });

  it('asks core for the original', async () => {
    const { ctx } = await enrichFile(jpeg, 'image/jpeg');
    expect(ctx.recorded.inputs).toEqual([{ assetId: 'a1', options: { input: 'original' } }]);
  });

  it('returns {} for a PNG without metadata', async () => {
    const { result, ctx } = await enrichFile(png, 'image/png');
    expect(result).toEqual({});
    expect(ctx.recorded.logs.filter((entry) => entry.level === 'warn')).toEqual([]);
  });

  it('returns {} and warns for a corrupt JPEG', async () => {
    const corrupt = fixtures.file('corrupt.jpg');
    writeFileSync(corrupt, 'this is not a photo at all');
    const { result, ctx } = await enrichFile(corrupt, 'image/jpeg');
    expect(result).toEqual({});
    expect(ctx.recorded.logs.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('returns {} for a JPEG cut off inside its EXIF segment', async () => {
    const truncated = fixtures.file('truncated.jpg');
    writeFileSync(truncated, Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 0x45, 0x78]));
    const { result } = await enrichFile(truncated, 'image/jpeg');
    expect(result).toEqual({});
  });
});

describe('shouldEnrich', () => {
  it('accepts photos and videos only', () => {
    expect(plugin.shouldEnrich?.(asset('a', 'image/heic'))).toBe(true);
    expect(plugin.shouldEnrich?.(asset('b', 'video/quicktime'))).toBe(true);
    expect(plugin.shouldEnrich?.(asset('c', 'application/pdf'))).toBe(false);
  });
});
