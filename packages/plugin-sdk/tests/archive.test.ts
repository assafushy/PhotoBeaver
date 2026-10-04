import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeSharedArchives,
  fixMojibake,
  fixMojibakeDeep,
  openArchive,
  openArchiveEntry,
  type ArchiveTree,
} from '../src/archive';
import { writeZip, type ZipInput } from './zip-writer';

let dir: string;
const trees: ArchiveTree[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pb-archive-'));
});

afterEach(async () => {
  await Promise.all(trees.splice(0).map((tree) => tree.close()));
  await closeSharedArchives();
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, data: Uint8Array | string): Promise<string> {
  const absolute = join(dir, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, data);
  return absolute;
}

async function putZip(path: string, inputs: ZipInput[], zip64 = false): Promise<void> {
  await put(path, writeZip(inputs, { zip64 }));
}

async function load(root = dir): Promise<ArchiveTree> {
  const tree = await openArchive(root);
  trees.push(tree);
  return tree;
}

async function bytesOf(tree: ArchiveTree, path: string): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of await tree.open(path)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function paths(tree: ArchiveTree): string[] {
  return tree.entries().map((entry) => entry.path);
}

describe('openArchive', () => {
  it('reads an extracted folder', async () => {
    const file = await put('Takeout/Google Photos/Trip/IMG_1.jpg', 'jpeg');
    await put('Takeout/Google Photos/Trip/IMG_1.jpg.json', '{"title":"IMG_1.jpg"}');
    await utimes(file, new Date('2021-05-06T07:08:09Z'), new Date('2021-05-06T07:08:09Z'));
    const tree = await load();
    expect(paths(tree)).toEqual([
      'Takeout/Google Photos/Trip/IMG_1.jpg',
      'Takeout/Google Photos/Trip/IMG_1.jpg.json',
    ]);
    expect(tree.get('Takeout/Google Photos/Trip/IMG_1.jpg')).toEqual({
      path: 'Takeout/Google Photos/Trip/IMG_1.jpg',
      size: 4,
      modifiedAt: '2021-05-06T07:08:09.000Z',
    });
    expect(await tree.readText('Takeout/Google Photos/Trip/IMG_1.jpg')).toBe('jpeg');
    expect(tree.root).toBe(dir);
  });

  it('reads a single zip with stored and deflated entries', async () => {
    await putZip('takeout-001.zip', [
      { name: 'Takeout/', data: '' },
      { name: 'Takeout/a.txt', data: 'stored text', method: 0 },
      { name: 'Takeout/b.txt', data: 'deflated '.repeat(50), method: 8 },
      { name: './Takeout/c.txt', data: 'dot', unixTime: new Date('2022-01-02T03:04:05Z') },
    ]);
    const tree = await load();
    expect(paths(tree)).toEqual(['Takeout/a.txt', 'Takeout/b.txt', 'Takeout/c.txt']);
    expect(await tree.readText('Takeout/a.txt')).toBe('stored text');
    expect(await tree.readText('Takeout/b.txt')).toBe('deflated '.repeat(50));
    expect(tree.get('Takeout/b.txt')?.size).toBe(450);
    expect(tree.get('Takeout/a.txt')?.modifiedAt).toBe('2020-01-02T03:04:06.000Z');
    expect(tree.get('Takeout/c.txt')?.modifiedAt).toBe('2022-01-02T03:04:05.000Z');
  });

  it('accepts a zip file as the root', async () => {
    await putZip('export.zip', [{ name: 'x.txt', data: 'x' }]);
    const tree = await load(join(dir, 'export.zip'));
    expect(paths(tree)).toEqual(['x.txt']);
  });

  it('merges zip parts, first part wins on duplicates', async () => {
    await putZip('takeout-002.zip', [
      { name: 'Takeout/two.txt', data: 'two' },
      { name: 'Takeout/dup.txt', data: 'from 002' },
    ]);
    await putZip('takeout-001.zip', [
      { name: 'Takeout/one.txt', data: 'one', method: 8 },
      { name: 'Takeout/dup.txt', data: 'from 001' },
    ]);
    const tree = await load();
    expect(paths(tree)).toEqual(['Takeout/dup.txt', 'Takeout/one.txt', 'Takeout/two.txt']);
    expect(await tree.readText('Takeout/dup.txt')).toBe('from 001');
  });

  it('merges loose files and zips, loose files win', async () => {
    await put('your_activity/posts/posts_1.json', '[]');
    await put('dup.txt', 'loose');
    await putZip('parts/facebook-1.ZIP', [
      { name: 'media/photo.jpg', data: 'photo' },
      { name: 'dup.txt', data: 'zipped' },
    ]);
    await put('notes.tgz', 'not supported');
    const tree = await load();
    expect(paths(tree)).toEqual([
      'dup.txt',
      'media/photo.jpg',
      'notes.tgz',
      'your_activity/posts/posts_1.json',
    ]);
    expect(await tree.readText('dup.txt')).toBe('loose');
    expect(tree.has('parts/facebook-1.ZIP')).toBe(false);
  });

  it('reads ZIP64 archives', async () => {
    await putZip(
      'big.zip',
      [
        { name: 'a.txt', data: 'zip64 stored' },
        { name: 'b.txt', data: 'zip64 deflated '.repeat(20), method: 8 },
      ],
      true,
    );
    const tree = await load();
    expect(paths(tree)).toEqual(['a.txt', 'b.txt']);
    expect(await tree.readText('a.txt')).toBe('zip64 stored');
    expect(await tree.readText('b.txt')).toBe('zip64 deflated '.repeat(20));
    expect(tree.get('b.txt')?.size).toBe(300);
  });

  it('decodes UTF-8 names and data descriptor entries', async () => {
    await putZip('names.zip', [
      { name: 'Fotos/Café/日本.jpg', data: 'utf8', utf8: true },
      { name: 'café.txt', data: 'latin1 name' },
      { name: 'descriptor.txt', data: 'streamed '.repeat(10), method: 8, dataDescriptor: true },
    ]);
    const tree = await load();
    expect(tree.has('Fotos/Café/日本.jpg')).toBe(true);
    expect(await tree.readText('café.txt')).toBe('latin1 name');
    expect(await tree.readText('descriptor.txt')).toBe('streamed '.repeat(10));
  });

  it('skips encrypted entries and paths that escape the root', async () => {
    await putZip('odd.zip', [
      { name: 'secret.txt', data: 'xxxx', encrypted: true },
      { name: '../evil.txt', data: 'evil' },
      { name: 'a/../../evil2.txt', data: 'evil' },
      { name: '/abs/ok.txt', data: 'ok' },
    ]);
    const tree = await load();
    expect(paths(tree)).toEqual(['abs/ok.txt']);
  });

  it('streams a large deflated entry', async () => {
    const source = Buffer.concat([randomBytes(2 * 1024 * 1024), Buffer.alloc(3 * 1024 * 1024, 7)]);
    await putZip('large.zip', [{ name: 'video.mp4', data: source, method: 8 }]);
    const tree = await load();
    expect(tree.get('video.mp4')?.size).toBe(source.length);
    expect((await bytesOf(tree, 'video.mp4')).equals(source)).toBe(true);
  });

  it('parses JSON from zips and folders', async () => {
    await put('a.json', '﻿{"x":1}');
    await putZip('b.zip', [{ name: 'b.json', data: '{"y":[1,2]}', method: 8 }]);
    const tree = await load();
    expect(await tree.readJson<{ x: number }>('a.json')).toEqual({ x: 1 });
    expect(await tree.readJson<{ y: number[] }>('b.json')).toEqual({ y: [1, 2] });
  });

  it('reads empty entries', async () => {
    await putZip('empty.zip', [{ name: 'empty.txt', data: '' }]);
    const tree = await load();
    expect(await tree.readText('empty.txt')).toBe('');
  });

  it('throws "not available" when the root is missing', async () => {
    await expect(openArchive(join(dir, 'unplugged'))).rejects.toThrow(/not available/);
  });

  it('throws for unknown paths and corrupt zips', async () => {
    await put('broken.zip', 'not a zip at all');
    await expect(openArchive(dir)).rejects.toThrow(/broken\.zip/);
    await rm(join(dir, 'broken.zip'));
    const tree = await load();
    await expect(tree.open('missing.txt')).rejects.toThrow(/missing\.txt/);
  });
});

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return Buffer.from(await new Response(stream).arrayBuffer()).toString();
}

describe('openArchiveEntry', () => {
  it('streams entries from loose files and zips, reusing the open archive', async () => {
    await put('loose.txt', 'loose');
    await putZip('part-1.zip', [{ name: 'a/one.txt', data: 'one', method: 8 }]);
    expect(await streamText(await openArchiveEntry(dir, 'a/one.txt', 20))).toBe('one');
    expect(await streamText(await openArchiveEntry(dir, 'loose.txt', 20))).toBe('loose');
  });

  it('rejects unknown paths and missing roots', async () => {
    await put('loose.txt', 'loose');
    await expect(openArchiveEntry(dir, 'nope.txt', 20)).rejects.toThrow();
    await expect(openArchiveEntry(join(dir, 'gone'), 'x', 20)).rejects.toThrow(/not available/);
  });

  it('reopens a shared archive once when the export gained a file', async () => {
    await put('photo.txt', 'v1');
    expect(await streamText(await openArchiveEntry(dir, 'photo.txt', 5000))).toBe('v1');
    await putZip('added.zip', [{ name: 'fresh.txt', data: 'fresh' }]);
    expect(await streamText(await openArchiveEntry(dir, 'fresh.txt', 5000))).toBe('fresh');
  });

  it('closes an idle archive so a changed export is read again', async () => {
    await put('photo.txt', 'v1');
    expect(await streamText(await openArchiveEntry(dir, 'photo.txt', 10))).toBe('v1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await putZip('new.zip', [{ name: 'later.txt', data: 'later' }]);
    expect(await streamText(await openArchiveEntry(dir, 'later.txt', 10))).toBe('later');
  });
});

describe('fixMojibake', () => {
  it('repairs Meta style mojibake', () => {
    expect(fixMojibake('CafÃ©')).toBe('Café');
    expect(fixMojibake('ð\u009f\u0098\u0080 party')).toBe('\u{1F600} party');
  });

  it('leaves correct and plain strings alone', () => {
    expect(fixMojibake('Café')).toBe('Café');
    expect(fixMojibake('plain ascii')).toBe('plain ascii');
    expect(fixMojibake('CafÃ© 日本')).toBe('CafÃ© 日本');
    expect(fixMojibake('')).toBe('');
  });

  it('repairs every string in nested data', () => {
    const input = {
      title: 'CafÃ©',
      count: 3,
      empty: null,
      tags: ['naÃ¯ve', { label: 'ð\u009f\u0098\u0080' }],
    };
    expect(fixMojibakeDeep(input)).toEqual({
      title: 'Café',
      count: 3,
      empty: null,
      tags: ['naïve', { label: '\u{1F600}' }],
    });
    expect(input.title).toBe('CafÃ©');
  });
});
