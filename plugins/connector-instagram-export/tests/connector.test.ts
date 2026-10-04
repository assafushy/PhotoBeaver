import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '@photobeaver/plugin-sdk';
import { createFakeSourceContext, runSync } from '@photobeaver/plugin-sdk/testing';
import connector, { NOT_INSTAGRAM_EXPORT } from '../src';
import {
  ACTIVITY,
  MEDIA_DIR,
  POSTS,
  carousel,
  media,
  simpleExport,
  tempDir,
  writeFiles,
  type FileMap,
  type Json,
  type TempDir,
} from './fixture';

let dir: TempDir;

beforeEach(() => {
  dir = tempDir();
});

afterEach(() => dir.cleanup());

async function syncItems(files: FileMap): Promise<MediaItem[]> {
  writeFiles(dir.root, files);
  return (await runSync(connector, { config: { root: dir.root } })).items;
}

function byId(items: MediaItem[], id: string): MediaItem {
  const item = items.find((candidate) => candidate.externalId === id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
}

function exif(row: Json): Json {
  return { media_metadata: { photo_metadata: { exif_data: [row] } } };
}

function single(uri: string, extra: Json = {}): FileMap {
  return { [POSTS]: JSON.stringify([{ media: [media(uri, extra)] }]), [uri]: 'x' };
}

describe('connector-instagram-export setup', () => {
  it('names the source after the export folder', async () => {
    writeFiles(dir.root, simpleExport([`${MEDIA_DIR}/1.jpg`]));
    const result = await connector.setupSource(createFakeSourceContext({ root: dir.root }));
    expect(result.displayName).toMatch(/^Instagram export \(pb-instagram-/);
  });

  it('rejects a folder that is not an Instagram export', async () => {
    writeFiles(dir.root, { 'photos/1.jpg': 'x', 'your_facebook_activity/posts/a.json': '[]' });
    const ctx = createFakeSourceContext({ root: dir.root });
    await expect(connector.setupSource(ctx)).rejects.toThrow(NOT_INSTAGRAM_EXPORT);
  });
});

describe('connector-instagram-export posts', () => {
  it('reads a single post with title and time on the media', async () => {
    const uri = `${MEDIA_DIR}/1.jpg`;
    const [item] = await syncItems(single(uri, { title: 'CafÃ©' }));
    expect(item).toMatchObject({ caption: 'Café', kind: 'image', filename: '1.jpg' });
    expect(item).toMatchObject({ path: '202401', metadata: { source: 'post' } });
    expect(item?.capturedAt).toBe(new Date(1_600_000_000_000).toISOString());
  });

  it('applies a carousel title and time to every media', async () => {
    const uris = [`${MEDIA_DIR}/1.jpg`, `${MEDIA_DIR}/2.mp4`];
    const files: FileMap = { [POSTS]: JSON.stringify([carousel(uris, 'Trip')]) };
    for (const uri of uris) files[uri] = 'x';
    const items = await syncItems(files);
    expect(items.map((item) => item.caption)).toEqual(['Trip', 'Trip']);
    expect(byId(items, uris[1]!).kind).toBe('video');
  });

  it('uses the post time when the media has none', async () => {
    const uri = `${MEDIA_DIR}/1.jpg`;
    const post = { media: [{ uri, title: '' }], title: 'T', creation_timestamp: 1_500_000_000 };
    const [item] = await syncItems({ [POSTS]: JSON.stringify([post]), [uri]: 'x' });
    expect(item?.capturedAt).toBe(new Date(1_500_000_000_000).toISOString());
  });

  it('prefers the EXIF taken time', async () => {
    const uri = `${MEDIA_DIR}/1.jpg`;
    const [item] = await syncItems(single(uri, exif({ taken_timestamp: 1_400_000_000 })));
    expect(item?.capturedAt).toBe(new Date(1_400_000_000_000).toISOString());
  });

  it('maps GPS and ignores 0,0', async () => {
    const [a, b] = [`${MEDIA_DIR}/1.jpg`, `${MEDIA_DIR}/2.jpg`];
    const posts = [
      { media: [media(a, exif({ latitude: 40.7, longitude: -74 }))] },
      { media: [media(b, exif({ latitude: 0, longitude: 0 }))] },
    ];
    const items = await syncItems({ [POSTS]: JSON.stringify(posts), [a]: 'x', [b]: 'y' });
    expect(byId(items, a).location).toEqual({ lat: 40.7, lon: -74 });
    expect(byId(items, b).location).toBeUndefined();
  });
});

describe('connector-instagram-export other media', () => {
  it('reads stories, reels and profile photos with their source', async () => {
    const [story, reel, profile] = [
      'media/stories/1.mp4',
      'media/reels/2.mp4',
      'media/other/3.jpg',
    ];
    const files: FileMap = {
      [`${ACTIVITY}/stories.json`]: JSON.stringify({ ig_stories: [media(story)] }),
      [`${ACTIVITY}/reels.json`]: JSON.stringify({ ig_reels_media: [{ media: [media(reel)] }] }),
      [`${ACTIVITY}/profile_photos.json`]: JSON.stringify({ ig_profile_picture: [media(profile)] }),
      [story]: 'a',
      [reel]: 'b',
      [profile]: 'c',
    };
    const items = await syncItems(files);
    expect(byId(items, story).metadata).toEqual({ source: 'story' });
    expect(byId(items, reel).metadata).toEqual({ source: 'reel' });
    expect(byId(items, profile).metadata).toEqual({ source: 'profile' });
  });

  it('reads the older content folder layout', async () => {
    const uri = 'media/posts/201901/1.jpg';
    const files = { 'content/posts_1.json': JSON.stringify([{ media: [media(uri)] }]), [uri]: 'x' };
    const [item] = await syncItems(files);
    expect(item?.externalId).toBe(uri);
  });

  it('reads the oldest media.json shape with path, caption and taken_at', async () => {
    const uri = 'photos/201801/1.jpg';
    const photo = { path: uri, caption: 'Old', taken_at: '2018-01-02T03:04:05+00:00' };
    const [item] = await syncItems({
      'media/media.json': JSON.stringify({ photos: [photo] }),
      [uri]: 'x',
    });
    expect(item).toMatchObject({ caption: 'Old', capturedAt: '2018-01-02T03:04:05.000Z' });
  });

  it('leaves out recently deleted content', async () => {
    const uri = 'media/recently_deleted/1.jpg';
    const deleted = JSON.stringify({ ig_recently_deleted_media: [{ media: [media(uri)] }] });
    const files = { [`${ACTIVITY}/recently_deleted_content.json`]: deleted, [uri]: 'x' };
    expect(await syncItems({ ...files, ...simpleExport([`${MEDIA_DIR}/1.jpg`]) })).toHaveLength(1);
  });
});
