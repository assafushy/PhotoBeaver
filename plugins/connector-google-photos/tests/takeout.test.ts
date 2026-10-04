import path from 'node:path';
import { createFakeSourceContext, runSync } from '@photobeaver/plugin-sdk/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import connector, { type GooglePhotosConfig } from '../src';
import { closeSharedArchives } from '@photobeaver/plugin-sdk/archive';
import { MISSING_ROOT } from '../src/takeout/root';
import {
  collect,
  PHOTOS,
  readText,
  sidecar,
  tempDir,
  writeFiles,
  writeZipFile,
  type TempDir,
} from './helpers';

let dir: TempDir;
const config = (): GooglePhotosConfig => ({ mode: 'takeout', root: dir.root });
const sync = (cursor: string | null = null) => runSync(connector, { config: config(), cursor });

beforeEach(() => {
  dir = tempDir();
});

afterEach(async () => {
  await closeSharedArchives();
  dir.cleanup();
});

afterAll(closeSharedArchives);

describe('Takeout albums', () => {
  beforeEach(() => {
    writeFiles(dir.root, {
      [`${PHOTOS}/Photos from 2020/IMG_1.jpg`]: 'same bytes',
      [`${PHOTOS}/Photos from 2020/IMG_1.jpg.supplemental-metadata.json`]: sidecar(),
      [`${PHOTOS}/Trip/IMG_1.jpg`]: 'same bytes',
      [`${PHOTOS}/Trip/IMG_1.jpg.supplemental-metadata.json`]: sidecar(),
      [`${PHOTOS}/Trip/only-here.mp4`]: 'video',
      [`${PHOTOS}/Trip/metadata.json`]: '{"title":"Trip"}',
      [`${PHOTOS}/Beach/IMG_1.jpg`]: 'other bytes',
      [`${PHOTOS}/Beach/IMG_1.jpg.json`]: sidecar(),
    });
  });

  it('yields one item per photo, in its year folder, listed in its albums', async () => {
    const { items, batches } = await sync();
    const trip = { externalId: `${PHOTOS}/Trip`, name: 'Trip' };
    expect(items.map((item) => [item.externalId, item.albums])).toEqual([
      [`${PHOTOS}/Beach/IMG_1.jpg`, [{ externalId: `${PHOTOS}/Beach`, name: 'Beach' }]],
      [`${PHOTOS}/Photos from 2020/IMG_1.jpg`, [trip]],
      [`${PHOTOS}/Trip/only-here.mp4`, [trip]],
    ]);
    expect(batches[0]!.albums).toHaveLength(2);
    expect(items[2]).toMatchObject({ kind: 'video', mime: 'video/mp4', path: 'Trip' });
  });

  it('ends with a full-scan batch and a fresh scan after it', async () => {
    const { batches, finalCursor } = await sync();
    expect(batches.at(-1)).toEqual({ upserts: [], cursor: 'done', isFullScan: true });
    expect((await sync(finalCursor)).items).toHaveLength(3);
  });

  it('resumes after the cursor of a batch', async () => {
    const { items } = await sync(`after:${PHOTOS}/Beach/IMG_1.jpg`);
    expect(items.map((item) => item.filename)).toEqual(['IMG_1.jpg', 'only-here.mp4']);
  });

  it('streams originals and has no thumbnails', async () => {
    const ctx = createFakeSourceContext(config());
    const item = { sourceId: 's', externalId: `${PHOTOS}/Trip/only-here.mp4` };
    expect(await readText(await connector.getOriginal(ctx, item))).toBe('video');
    expect(await connector.getThumbnail!(ctx, item, 256)).toBeNull();
    const missing = { sourceId: 's', externalId: `${PHOTOS}/Trip/nope.jpg` };
    await expect(connector.getOriginal(ctx, missing)).rejects.toThrow(/not in the export/);
  });
});

describe('Takeout metadata', () => {
  function photoWith(json: string) {
    writeFiles(dir.root, {
      [`${PHOTOS}/Photos from 2021/a.jpg`]: 'a',
      [`${PHOTOS}/Photos from 2021/a.jpg.supplemental-metadata.json`]: json,
    });
  }

  it('reads time, caption, title, link and location from the sidecar', async () => {
    photoWith(sidecar({ title: 'Original.jpg', description: ' Hi ', geo: [32.1, 34.8] }));
    const [item] = (await sync()).items;
    expect(item).toMatchObject({
      capturedAt: '2020-01-01T00:00:00.000Z',
      caption: 'Hi',
      location: { lat: 32.1, lon: 34.8 },
      externalUrl: 'https://photos.google.com/photo/AF1Qip',
      metadata: { title: 'Original.jpg' },
      sizeBytes: 1,
    });
    expect(item!.etag).toBe(`1-${item!.modifiedAt}`);
  });

  it('treats 0,0 as no location and falls back to the EXIF location', async () => {
    photoWith(sidecar({ geo: [0, 0], exif: [48.85, 2.35] }));
    expect((await sync()).items[0]!.location).toEqual({ lat: 48.85, lon: 2.35 });
  });

  it('ignores a 0,0 location everywhere', async () => {
    photoWith(sidecar({ description: '' }));
    const [item] = (await sync()).items;
    expect(item!.location).toBeUndefined();
    expect(item!.caption).toBeUndefined();
  });

  it('keeps photos with an unreadable sidecar', async () => {
    photoWith('{not json');
    const result = await sync();
    expect(result.items[0]!.capturedAt).toBeUndefined();
    expect(result.recorded.logs.some((line) => line.level === 'warn')).toBe(true);
  });
});

describe('Takeout layouts', () => {
  it('merges multi-part zips where media and sidecars are split', async () => {
    writeZipFile(path.join(dir.root, 'takeout-001.zip'), {
      [`${PHOTOS}/Photos from 2019/a.jpg`]: 'alpha',
      [`${PHOTOS}/Photos from 2019/b.jpg.supplemental-metadata.json`]: sidecar({ timestamp: 2 }),
    });
    writeZipFile(path.join(dir.root, 'takeout-002.zip'), {
      [`${PHOTOS}/Photos from 2019/a.jpg.supplemental-metadata.json`]: sidecar({ timestamp: 1 }),
      [`${PHOTOS}/Photos from 2019/b.jpg`]: 'bravo',
    });
    const { items } = await sync();
    expect(items.map((item) => [item.filename, item.capturedAt])).toEqual([
      ['a.jpg', '1970-01-01T00:00:01.000Z'],
      ['b.jpg', '1970-01-01T00:00:02.000Z'],
    ]);
    const ctx = createFakeSourceContext(config());
    const ref = { sourceId: 's', externalId: items[1]!.externalId };
    expect(await readText(await connector.getOriginal(ctx, ref))).toBe('bravo');
  });

  it('finds localized folders and a root that is the Google Photos folder', async () => {
    writeFiles(dir.root, {
      'Fotos von 2022/x.jpg': 'x',
      'Fotos von 2022/x.jpg.json': sidecar(),
      'Urlaub/x.jpg': 'x',
      'Urlaub/x.jpg.json': sidecar(),
    });
    const { items } = await sync();
    expect(items.map((item) => [item.externalId, item.albums?.[0]?.name])).toEqual([
      ['Fotos von 2022/x.jpg', 'Urlaub'],
    ]);
  });

  it('ignores media outside the Google Photos folders', async () => {
    writeFiles(dir.root, {
      'Takeout/Google Fotos/Album/x.jpg': 'x',
      'Takeout/Google Fotos/Album/x.jpg.json': sidecar(),
      'Takeout/Drive/holiday.jpg': 'y',
      'Takeout/archive_browser.html': '<html>',
    });
    const { items } = await sync();
    expect(items.map((item) => item.externalId)).toEqual(['Takeout/Google Fotos/Album/x.jpg']);
  });

  it('fails without any batch when the folder is missing', async () => {
    const root = path.join(dir.root, 'unplugged');
    const run = runSync(connector, { config: { mode: 'takeout', root } });
    await expect(run).rejects.toThrow(/not available/);
  });

  it('skips items whose etag core already knows', async () => {
    writeFiles(dir.root, {
      'Photos from 2020/a.jpg': 'a',
      'Photos from 2020/a.jpg.json': sidecar(),
      'Photos from 2020/b.jpg': 'b',
    });
    const first = (await sync()).items;
    const known = { [first[0]!.externalId]: { etag: first[0]!.etag } };
    const again = await runSync(connector, { config: config(), known });
    expect(again.items.map((item) => item.filename)).toEqual(['b.jpg']);
  });
});

describe('Takeout setup', () => {
  it('names the source after the folder and keeps no secret', async () => {
    writeFiles(dir.root, { 'Photos from 2020/a.jpg': 'a', 'Photos from 2020/a.jpg.json': '{}' });
    const result = await connector.setupSource(createFakeSourceContext(config()));
    expect(result).toEqual({ displayName: `Google Takeout (${path.basename(dir.root)})` });
    await expect(connector.testSource!(createFakeSourceContext(config()))).resolves.toBeUndefined();
  });

  it('rejects folders without a Google Photos export', async () => {
    writeFiles(dir.root, { 'random/a.jpg': 'a', 'notes.txt': 'n' });
    const setup = connector.setupSource(createFakeSourceContext(config()));
    await expect(setup).rejects.toThrow(/No Google Photos export/);
  });

  it('requires a folder', async () => {
    const ctx = createFakeSourceContext<GooglePhotosConfig>({ mode: 'takeout' });
    await expect(connector.setupSource(ctx)).rejects.toThrow(MISSING_ROOT);
    await expect(
      collect(
        connector.sync(
          { ...ctx, reportProgress: () => undefined, isKnown: async () => ({}) },
          null,
        ),
      ),
    ).rejects.toThrow(MISSING_ROOT);
  });
});
