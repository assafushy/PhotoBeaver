import { describe, expect, it } from 'vitest';
import { runSync } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { dropboxArg } from '../src/api';
import { normalizeFolder } from '../src/config';
import { contextFor, seededDropbox } from './helpers';

describe('mapping', () => {
  it('maps media files and skips everything else', async () => {
    const fake = seededDropbox();
    const { items } = await runSync(connector, { config: {}, context: contextFor(fake) });
    expect(items.map((item) => item.filename).sort()).toEqual([
      'IMG_0001.png',
      'IMG_0002.mp4',
      'beach.jpg',
      'clip.mov',
      'dsc_001.nef',
      'snow.HEIC',
      'top.webp',
    ]);
  });

  it('fills ids, hashes, types and links from the Dropbox entry', async () => {
    const fake = seededDropbox();
    const file = fake.addFile('/Trip Ä/Day 1/clip.MOV', 'video bytes');
    const { items } = await runSync(connector, { config: {}, context: contextFor(fake) });
    expect(items.find((item) => item.externalId === file.id)).toEqual({
      externalId: file.id,
      kind: 'video',
      mime: 'video/quicktime',
      filename: 'clip.MOV',
      path: '/Trip Ä/Day 1',
      sizeBytes: 11,
      modifiedAt: file.modified,
      etag: file.rev,
      contentHash: { algo: 'dropbox', value: 'hash-video bytes' },
      externalUrl: 'https://www.dropbox.com/home/Trip%20%C3%84/Day%201',
    });
  });

  it('uses "/" as the path of files in the root', async () => {
    const fake = seededDropbox(['/top.jpg']);
    const { items } = await runSync(connector, { config: {}, context: contextFor(fake) });
    expect(items[0]).toMatchObject({ path: '/', externalUrl: 'https://www.dropbox.com/home' });
  });

  it('lists only the configured folder', async () => {
    const fake = seededDropbox();
    const config = { folder: 'camera uploads' };
    const { items } = await runSync(connector, { config, context: contextFor(fake) });
    expect(items.map((item) => item.filename).sort()).toEqual(['IMG_0001.png', 'IMG_0002.mp4']);
  });

  it('normalizes folder paths', () => {
    expect(['', ' ', '/', 'a', '/a/', 'a/b//'].map(normalizeFolder)).toEqual([
      '',
      '',
      '',
      '/a',
      '/a',
      '/a/b',
    ]);
  });

  it('escapes non-ASCII characters in Dropbox-API-Arg', () => {
    expect(dropboxArg({ path: '/Café/😀.jpg' })).toBe('{"path":"/Caf\\u00e9/\\ud83d\\ude00.jpg"}');
  });
});
