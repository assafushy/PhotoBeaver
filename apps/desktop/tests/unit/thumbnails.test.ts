import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { schema } from '@photobeaver/db';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDurationMs } from '../../src/main/core/thumbnails/video-frame';
import { thumbPath } from '../../src/main/core/thumbnails/thumb-paths';
import { writeImage, writeVideo } from '../fixtures/generate';
import { localHarness } from './core-harness';
import { openTempLibrary, type TempLibrary } from './helpers';

describe('ThumbnailService with connector-local', () => {
  let temp: TempLibrary;
  let root: string;

  const byName = (name: string) => {
    const rows = temp.library.sqlite
      .prepare(
        `SELECT a.* FROM assets a JOIN instances i ON i.asset_id = a.id WHERE i.external_id LIKE ?`,
      )
      .all(`%${name}`) as {
      id: string;
      thumb_state: string;
      width: number;
      height: number;
      duration_ms: number | null;
    }[];
    return rows[0]!;
  };

  beforeEach(async () => {
    temp = await openTempLibrary();
    root = mkdtempSync(path.join(tmpdir(), 'pb-thumbs-'));
  });

  afterEach(() => {
    temp.cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  it('renders upright WebP thumbnails, records dimensions and marks undecodable files failed', async () => {
    await writeImage(root, { file: 'landscape.jpg', width: 400, height: 300 });
    await writeImage(root, { file: 'rotated.jpg', width: 400, height: 300, orientation: 6 });
    await writeImage(root, { file: 'small.png', width: 100, height: 50 });
    writeFileSync(path.join(root, 'broken.heic'), 'not really an image');
    const harness = localHarness(temp);
    harness.addSource('s', root);
    await harness.sync('s');
    await harness.drainThumbnails();

    const thumbsDir = path.join(temp.dir, 'thumbs');
    const landscape = byName('landscape.jpg');
    expect(landscape).toMatchObject({ thumb_state: 'ready', width: 400, height: 300 });
    expect(
      await sharp(readFileSync(thumbPath(thumbsDir, landscape.id, 256))).metadata(),
    ).toMatchObject({
      format: 'webp',
      width: 341,
      height: 256,
    });
    expect(byName('rotated.jpg')).toMatchObject({ width: 300, height: 400 });
    const small = byName('small.png');
    expect(
      await sharp(readFileSync(thumbPath(thumbsDir, small.id, 1024))).metadata(),
    ).toMatchObject({
      width: 100,
      height: 50,
    });
    expect(byName('broken.heic').thumb_state).toBe('failed');
    expect(harness.ready).toHaveLength(4);
  });

  it('extracts a video frame and duration through the original cache', async () => {
    await writeVideo(root, 'clip.mp4', 2);
    const harness = localHarness(temp);
    harness.addSource('s', root);
    await harness.sync('s');
    await harness.drainThumbnails();
    const clip = byName('clip.mp4');
    expect(clip).toMatchObject({ thumb_state: 'ready', width: 160, height: 90, duration_ms: 2000 });
    expect(existsSync(path.join(temp.dir, 'cache', clip.id))).toBe(true);
    expect(temp.library.db.select().from(schema.assets).all()).toHaveLength(1);
  });

  it('parses ffmpeg durations', () => {
    expect(parseDurationMs('  Duration: 00:01:02.50, start: 0')).toBe(62_500);
    expect(parseDurationMs('nothing')).toBeNull();
  });
});
