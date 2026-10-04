import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrichFile } from './helpers';
import { injectXyz, makeFixtureDir, writeVideo } from './fixtures';

const fixtures = makeFixtureDir();
const mp4 = fixtures.file('tokyo.mp4');
const mov = fixtures.file('tokyo.mov');
const appleMov = fixtures.file('apple.mov');
const TOKYO = '+35.6895+139.6917/';
const CREATED = ['-metadata', 'creation_time=2021-07-04T10:11:12Z'];
const CREATED_MS = Date.parse('2021-07-04T10:11:12Z');
const CREATED_LOCAL = new Date(
  CREATED_MS - new Date(CREATED_MS).getTimezoneOffset() * 60000,
).toISOString();

function expectTokyo(location: { lat: number; lon: number } | undefined): void {
  expect(location?.lat).toBeCloseTo(35.6895, 4);
  expect(location?.lon).toBeCloseTo(139.6917, 4);
}

describe('videos', () => {
  beforeAll(() => {
    writeVideo(mp4, CREATED);
    injectXyz(mp4, TOKYO);
    writeVideo(mov, [...CREATED, '-metadata', `location=${TOKYO}`]);
    writeVideo(appleMov, [
      ...CREATED,
      '-movflags',
      'use_metadata_tags',
      '-metadata',
      `com.apple.quicktime.location.ISO6709=${TOKYO}`,
      '-metadata',
      'com.apple.quicktime.creationdate=2021-07-04T19:11:12+0900',
      '-metadata',
      'com.apple.quicktime.model=iPhone 15',
    ]);
  });
  afterAll(() => fixtures.cleanup());

  it('reads an MP4: mvhd time as local floating time, ©xyz location, size and duration', async () => {
    const { result } = await enrichFile(mp4, 'video/mp4');
    expect(result.capturedAt).toBe(CREATED_LOCAL);
    expectTokyo(result.location);
    expect(result.dimensions).toEqual({ width: 320, height: 240, durationMs: 2000 });
  });

  it('reads ©xyz written by ffmpeg into a MOV', async () => {
    const { result } = await enrichFile(mov, 'video/quicktime');
    expect(result.capturedAt).toBe(CREATED_LOCAL);
    expectTokyo(result.location);
  });

  it('prefers the Apple creation date, as the wall clock of its offset', async () => {
    const { result } = await enrichFile(appleMov, 'video/quicktime');
    expect(result.capturedAt).toBe('2021-07-04T19:11:12.000Z');
    expectTokyo(result.location);
    expect(result.data).toEqual({ exif: { model: 'iPhone 15' } });
    expect(result.searchText).toBe('iPhone 15');
  });

  it('returns {} for videos that are not MP4 or MOV', async () => {
    const { result } = await enrichFile(mp4, 'video/x-msvideo');
    expect(result).toEqual({});
  });

  it('returns {} for a file without a moov box', async () => {
    const broken = fixtures.file('broken.mp4');
    writeFileSync(broken, Buffer.from('0000001866747970isom', 'hex'));
    const { result } = await enrichFile(broken, 'video/mp4');
    expect(result).toEqual({});
  });
});
