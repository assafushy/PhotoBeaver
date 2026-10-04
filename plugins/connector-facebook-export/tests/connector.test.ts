import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '@photobeaver/plugin-sdk';
import { createFakeSourceContext, runSync } from '@photobeaver/plugin-sdk/testing';
import connector, { NOT_FACEBOOK_EXPORT } from '../src';
import {
  MEDIA_DIR,
  POSTS,
  media,
  post,
  simpleExport,
  tempDir,
  writeFiles,
  type FileMap,
  type TempDir,
} from './fixture';

let dir: TempDir;

beforeEach(() => {
  dir = tempDir();
});

afterEach(() => dir.cleanup());

async function syncItems(files: FileMap, root = dir.root): Promise<MediaItem[]> {
  writeFiles(dir.root, files);
  return (await runSync(connector, { config: { root } })).items;
}

function byId(items: MediaItem[], id: string): MediaItem {
  const item = items.find((candidate) => candidate.externalId === id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
}

function exif(row: Record<string, unknown>): Record<string, unknown> {
  return { media_metadata: { photo_metadata: { exif_data: [row] } } };
}

describe('connector-facebook-export setup', () => {
  it('names the source after the export folder', async () => {
    writeFiles(dir.root, simpleExport([`${MEDIA_DIR}/a/1.jpg`]));
    const result = await connector.setupSource(createFakeSourceContext({ root: dir.root }));
    expect(result.displayName).toMatch(/^Facebook export \(pb-facebook-/);
  });

  it('rejects a folder that is not a Facebook export', async () => {
    writeFiles(dir.root, { 'photos/1.jpg': 'x', 'notes.json': '{}' });
    const ctx = createFakeSourceContext({ root: dir.root });
    await expect(connector.setupSource(ctx)).rejects.toThrow(NOT_FACEBOOK_EXPORT);
  });
});

describe('connector-facebook-export sync', () => {
  it('repairs mojibake in captions and uses the post text', async () => {
    const uri = `${MEDIA_DIR}/a/1.jpg`;
    const files = { [POSTS]: JSON.stringify([post([media(uri)], 'CafÃ©')]), [uri]: 'x' };
    const [item] = await syncItems(files);
    expect(item).toMatchObject({ caption: 'Café', kind: 'image', mime: 'image/jpeg' });
    expect(item).toMatchObject({ filename: '1.jpg', path: 'a', metadata: { source: 'post' } });
  });

  it('prefers the media description and the EXIF taken time', async () => {
    const uri = `${MEDIA_DIR}/a/1.jpg`;
    const fields = { description: 'On the beach', ...exif({ taken_timestamp: 1_400_000_000 }) };
    const files = { [POSTS]: JSON.stringify([post([media(uri, fields)], 'Post')]), [uri]: 'x' };
    const [item] = await syncItems(files);
    expect(item?.caption).toBe('On the beach');
    expect(item?.capturedAt).toBe(new Date(1_400_000_000_000).toISOString());
  });

  it('falls back to creation_timestamp', async () => {
    const [item] = await syncItems(simpleExport([`${MEDIA_DIR}/a/1.jpg`]));
    expect(item?.capturedAt).toBe(new Date(1_600_000_000_000).toISOString());
  });

  it('maps GPS and ignores 0,0', async () => {
    const [a, b] = [`${MEDIA_DIR}/a/1.jpg`, `${MEDIA_DIR}/a/2.jpg`];
    const posts = [
      post([media(a, exif({ latitude: 32.08, longitude: 34.78 }))]),
      post([media(b, exif({ latitude: 0, longitude: 0 }))]),
    ];
    const items = await syncItems({ [POSTS]: JSON.stringify(posts), [a]: 'x', [b]: 'y' });
    expect(byId(items, a).location).toEqual({ lat: 32.08, lon: 34.78 });
    expect(byId(items, b).location).toBeUndefined();
  });

  it('merges a photo found in a post and an album, keeping the album', async () => {
    const uri = `${MEDIA_DIR}/Trip_1/1.jpg`;
    const album = 'your_facebook_activity/posts/album/0.json';
    const albumJson = { name: 'Trip', photos: [media(uri, { title: 'Trip' })], cover_photo: {} };
    const files = { ...simpleExport([uri]), [album]: JSON.stringify(albumJson) };
    const items = await syncItems(files);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: 'Trip', metadata: { source: 'post' } });
    expect(items[0]?.albums).toEqual([{ externalId: album, name: 'Trip' }]);
    expect(items[0]?.caption).toBeUndefined();
  });

  it('reports albums with the batch', async () => {
    const uri = `${MEDIA_DIR}/Trip_1/1.mp4`;
    const album = 'your_facebook_activity/posts/album/0.json';
    writeFiles(dir.root, { [album]: JSON.stringify({ name: 'Trip', photos: [media(uri)] }) });
    writeFiles(dir.root, { [uri]: 'x' });
    const result = await runSync(connector, { config: { root: dir.root } });
    expect(result.batches[0]?.albums).toEqual([{ externalId: album, name: 'Trip' }]);
    expect(result.items[0]).toMatchObject({ kind: 'video', metadata: { source: 'album' } });
  });

  it('reads the older posts and photos_and_videos layout', async () => {
    const uri = 'photos_and_videos/Old_1/1.jpg';
    const albumJson = { name: 'Old', photos: [media(uri, { description: 'Old one' })] };
    const files: FileMap = {
      'photos_and_videos/album/1.json': JSON.stringify(albumJson),
      'posts/your_posts_1.json': '[]',
      [uri]: 'x',
    };
    const [item] = await syncItems(files);
    expect(item).toMatchObject({ externalId: uri, caption: 'Old one', path: 'Old' });
  });
});
