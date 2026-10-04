import { describe, expect, it } from 'vitest';
import { runSync } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { contentHashOf, toMediaItem } from '../src/mapping';
import { parentPathOf } from '../src/paths';
import { FakeGraph, graphContext, seedLibrary } from './fake-graph';

async function syncedItems() {
  const graph = new FakeGraph();
  seedLibrary(graph);
  const { items } = await runSync(connector, { config: {}, context: graphContext(graph) });
  return new Map(items.map((item) => [item.externalId, item]));
}

describe('mapping Graph items', () => {
  it('maps a photo with its capture time, location, hash and folder path', async () => {
    const photo = (await syncedItems()).get('p1')!;
    expect(photo).toMatchObject({
      kind: 'image',
      mime: 'image/jpeg',
      filename: 'beach.jpg',
      path: 'Pictures/2024',
      sizeBytes: 1000,
      width: 4000,
      height: 3000,
      capturedAt: '2024-07-01T12:00:00Z',
      modifiedAt: '2024-05-01T10:00:00Z',
      contentHash: { algo: 'quickxor', value: 'qx-p1=' },
      location: { lat: 32.1, lon: 34.8 },
      externalUrl: 'https://onedrive.live.com/?id=p1',
    });
    expect(photo.etag).toMatch(/^c-p1-/);
  });

  it('maps a video with its duration in milliseconds', async () => {
    const video = (await syncedItems()).get('v1')!;
    expect(video).toMatchObject({ kind: 'video', durationMs: 12_345, width: 1920, height: 1080 });
  });

  it('keeps media found by MIME type and skips other files and folders', async () => {
    const items = await syncedItems();
    expect([...items.keys()].sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'v1']);
    expect(items.get('p3')).toMatchObject({
      kind: 'image',
      contentHash: undefined,
      path: 'Pictures',
    });
    expect(items.get('p4')!.path).toBe('');
  });

  it('falls back to the file extension and to the parentReference path', () => {
    const raw = {
      id: 'x',
      name: 'IMG.CR2',
      file: {},
      parentReference: { path: '/drive/root:/My%20Photos' },
    };
    expect(toMediaItem(raw, parentPathOf({}, raw))).toMatchObject({
      kind: 'image',
      path: 'My Photos',
    });
    expect(parentPathOf({}, { id: 'z', parentReference: { path: '/drive/root:' } })).toBe('');
    expect(toMediaItem({ id: 'y', name: 'a.txt', file: {} }, undefined)).toBeNull();
  });

  it('uses sha256 only when there is no QuickXorHash', () => {
    expect(contentHashOf({ id: 'a', file: { hashes: { sha256Hash: 'ABC' } } })).toEqual({
      algo: 'sha256',
      value: 'abc',
    });
  });
});
