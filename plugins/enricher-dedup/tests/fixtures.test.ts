import { closeSync, copyFileSync, ftruncateSync, mkdirSync, openSync, writeSync } from 'node:fs';
import path from 'node:path';
import type { AssetView } from '@photobeaver/plugin-sdk';
import {
  createFakeEnrichContext,
  runEnrich,
  type FakeEnrichContext,
  type FakeEnrichOptions,
} from '@photobeaver/plugin-sdk/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import plugin, { type DedupSettings } from '../src';
import { hamming, fromHex } from '../src/image/hash64';
import {
  blobs,
  fixtureAsset,
  render,
  tempDir,
  writeJpeg,
  writeThumbnail,
  type Blob,
  type FixtureAsset,
} from './helpers';

const temp = tempDir();
afterAll(() => temp.cleanup());
function file(name: string): string {
  const absolute = path.join(temp.dir, name);
  mkdirSync(path.dirname(absolute), { recursive: true });
  return absolute;
}
const fixtures: Record<string, FixtureAsset> = {};

function moved(scene: Blob[]): Blob[] {
  return scene.map((blob, i) =>
    i === scene.length - 1 ? { ...blob, x: blob.x + 25, y: blob.y + 10 } : blob,
  );
}

async function photo(
  id: string,
  name: string,
  raw: Buffer,
  extra: Partial<AssetView> = {},
  quality = 92,
  width?: number,
) {
  await writeJpeg(raw, file(name), quality, width);
  fixtures[id] = fixtureAsset(id, file(name), {
    ...extra,
    thumbnail: await writeThumbnail(file(name)),
  });
}

async function copy(id: string, from: string, name: string, extra: Partial<AssetView> = {}) {
  copyFileSync(file(from), file(name));
  fixtures[id] = fixtureAsset(id, file(name), {
    ...extra,
    thumbnail: await writeThumbnail(file(name)),
  });
}

function sparseVideo(name: string): string {
  const fd = openSync(file(name), 'w');
  ftruncateSync(fd, 201 * 1024 * 1024);
  writeSync(fd, Buffer.from('moov'), 0, 4, 100 * 1024 * 1024);
  closeSync(fd);
  return file(name);
}

beforeAll(async () => {
  const scene = blobs(11);
  const raw = render(scene, 11);
  await photo('a', 'folder1/IMG_0001.jpg', raw);
  await copy('a2', 'folder1/IMG_0001.jpg', 'folder2/IMG_0001.jpg');
  await photo('resized', 'resized/IMG_0001.jpg', raw, {}, 85, 320);
  await photo('reencoded', 'reencoded/IMG_0001.jpg', raw, {}, 60);
  await photo('unrelated', 'other/IMG_0042.jpg', render(blobs(99), 99));
  const burst = blobs(21);
  await photo('burst1', 'burst/IMG_1000.jpg', render(burst, 21), {
    capturedAt: '2026-05-01T10:00:00',
  });
  await photo('burst2', 'burst/IMG_1001.jpg', render(moved(burst), 21), {
    capturedAt: '2026-05-01T10:00:01',
  });
  const thumb = await writeThumbnail(file('folder1/IMG_0001.jpg'));
  const video = { kind: 'video' as const, mime: 'video/mp4', thumbnail: thumb };
  fixtures.v1 = fixtureAsset('v1', sparseVideo('videos/big1.mp4'), video);
  fixtures.v2 = fixtureAsset('v2', sparseVideo('videos/big2.mp4'), video);
});

function context(
  ids: string[],
  settings: Partial<DedupSettings> = {},
  extra: FakeEnrichOptions = {},
) {
  const inputs = Object.fromEntries(ids.map((id) => [id, fixtures[id]!.inputs]));
  return createFakeEnrichContext<DedupSettings>({ settings, inputs, ...extra });
}

async function run(ctx: FakeEnrichContext<DedupSettings>, ids: string[]) {
  return runEnrich(
    plugin,
    ids.map((id) => fixtures[id]!.asset),
    ctx,
  );
}

function phashOf(ctx: FakeEnrichContext<DedupSettings>, id: string) {
  const key = [...ctx.identity.entries()].find(
    ([k, ids]) => k.startsWith('phash:') && ids.has(id),
  )![0];
  return fromHex(key.slice('phash:'.length))!;
}

function originalReads(ctx: FakeEnrichContext<DedupSettings>, id: string) {
  return ctx.recorded.inputs.filter((i) => i.assetId === id && i.options?.input === 'original');
}

describe('enricher-dedup fixture suite (SPEC 11)', () => {
  it('merges the same file in two folders', async () => {
    const ctx = context(['a', 'a2']);
    const results = await run(ctx, ['a', 'a2']);
    expect(results.get('a')!.mergeWith).toBeUndefined();
    expect(originalReads(ctx, 'a')).toHaveLength(1);
    expect(results.get('a2')!.mergeWith).toEqual(['a']);
    expect(results.get('a2')!.suggestDuplicates).toBeUndefined();
    const keys = results.get('a2')!.identityKeys!;
    for (const prefix of ['size:', 'sha256:', 'src:dropbox:', 'src:quickxor:', 'phash:', 'dhash:'])
      expect(
        keys.some((k) => k.startsWith(prefix)),
        prefix,
      ).toBe(true);
  });

  it('skips hashing when no other asset has the same size', async () => {
    const ctx = context(['a', 'unrelated']);
    const results = await run(ctx, ['a', 'unrelated']);
    expect(ctx.recorded.inputs.filter((i) => i.options?.input === 'original')).toEqual([]);
    expect(results.get('unrelated')!.identityKeys!.some((k) => k.startsWith('sha256:'))).toBe(
      false,
    );
  });

  it('matches by source hash without reading originals', async () => {
    const hash = { algo: 'dropbox', value: 'abc123' };
    const withHash = (id: string): AssetView => ({
      ...fixtures[id]!.asset,
      instances: [{ sourceId: 'dropbox', contentHash: hash }],
    });
    const ctx = context(['a', 'unrelated']);
    const results = await runEnrich(plugin, [withHash('a'), withHash('unrelated')], ctx);
    expect(results.get('unrelated')!.mergeWith).toEqual(['a']);
    expect(ctx.recorded.inputs.filter((i) => i.options?.input === 'original')).toEqual([]);
  });

  it('suggests resized and re-encoded copies as one group in finalize and never merges them', async () => {
    const ctx = context(['a', 'resized', 'reencoded', 'unrelated']);
    const results = await run(ctx, ['a', 'resized', 'reencoded', 'unrelated']);
    for (const result of results.values()) expect(result.mergeWith).toBeUndefined();
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toHaveLength(1);
    const [suggestion] = ctx.recorded.suggestions;
    expect(suggestion!.assetIds).toEqual(['a', 'reencoded', 'resized']);
    expect(suggestion!.kind).toBe('near');
    expect(suggestion!.confidence).toBeGreaterThanOrEqual(1 - 6 / 64);
  });

  it('does not repeat near suggestions on the next finalize', async () => {
    const ctx = context(['a', 'resized']);
    await run(ctx, ['a', 'resized']);
    await plugin.finalize!(ctx);
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toHaveLength(1);
  });

  it('does not suggest burst shots taken 1 s apart', async () => {
    const ctx = context(['burst1', 'burst2']);
    await run(ctx, ['burst1', 'burst2']);
    const distance = hamming(phashOf(ctx, 'burst1'), phashOf(ctx, 'burst2'));
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThanOrEqual(6);
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toEqual([]);
  });

  it('suggests the same shots when they are not a burst', async () => {
    const ctx = context(['burst1', 'burst2']);
    const late = { ...fixtures.burst2!.asset, capturedAt: '2026-05-01T10:05:00' };
    await runEnrich(plugin, [fixtures.burst1!.asset, late], ctx);
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toHaveLength(1);
  });

  it('suggests an exact duplicate instead of merging when exactMerge is ask', async () => {
    const ctx = context(['a', 'a2'], { exactMerge: 'ask' });
    const results = await run(ctx, ['a', 'a2']);
    expect(results.get('a2')!.mergeWith).toBeUndefined();
    expect(results.get('a2')!.suggestDuplicates).toEqual([
      { assetIds: ['a2', 'a'], kind: 'exact', confidence: 1 },
    ]);
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toEqual([]);
  });

  it('neither merges nor suggests a pair the user unmerged, also on re-run', async () => {
    const ctx = context(['a', 'a2'], {}, { blockedPairs: [['a', 'a2']] });
    for (let round = 0; round < 2; round += 1) {
      const results = await run(ctx, ['a', 'a2']);
      expect(results.get('a2')!.mergeWith).toBeUndefined();
      expect(results.get('a2')!.suggestDuplicates).toBeUndefined();
    }
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toEqual([]);
  });

  it('does not read originals for a size-only candidate when downloadToCompare is off', async () => {
    const ctx = context(['a', 'a2'], { downloadToCompare: false });
    const results = await run(ctx, ['a', 'a2']);
    expect(originalReads(ctx, 'a')).toEqual([]);
    expect(originalReads(ctx, 'a2')).toEqual([]);
    expect(results.get('a2')!.mergeWith).toBeUndefined();
    expect(results.get('a2')!.identityKeys).toContain(
      `size:${fixtures.a2!.asset.instances[0]!.sizeBytes}`,
    );
  });

  it('skips perceptual hashing when nearDuplicates is off', async () => {
    const ctx = context(['a'], { nearDuplicates: false });
    const results = await run(ctx, ['a']);
    expect(results.get('a')!.identityKeys!.some((k) => k.startsWith('phash:'))).toBe(false);
    expect(ctx.recorded.inputs).toEqual([]);
  });

  it('uses a sampled hash for videos over 200 MB and only suggests', async () => {
    const ctx = context(['v1', 'v2'], { nearDuplicates: false });
    const results = await run(ctx, ['v1', 'v2']);
    const keys = results.get('v2')!.identityKeys!;
    expect(keys.some((k) => k.startsWith('vsample:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('sha256:'))).toBe(false);
    expect(results.get('v2')!.mergeWith).toBeUndefined();
    expect(results.get('v2')!.suggestDuplicates).toEqual([
      { assetIds: ['v2', 'v1'], kind: 'exact', confidence: 0.99 },
    ]);
  });
});
