import type { AssetView } from '@photobeaver/plugin-sdk';
import { createFakeEnrichContext } from '@photobeaver/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';
import plugin, { type DedupSettings } from '../src';
import { balancedChunks, clusters, planGroups } from '../src/near/clusters';
import { nearPairs } from '../src/near/pairs';
import { SuggestedMemory, nearIndex } from '../src/store';

const SAME = '00000000ffffffff';
const OTHER = 'ffffffff00000000';

function id(n: number): string {
  return `asset-${String(n).padStart(4, '0')}`;
}

function contextWith(hashes: Record<string, string>) {
  const identity = new Map<string, Set<string>>();
  for (const [assetId, hex] of Object.entries(hashes)) {
    const key = `phash:${hex}`;
    identity.set(key, (identity.get(key) ?? new Set()).add(assetId));
  }
  return createFakeEnrichContext<DedupSettings>({ identity });
}

function addHash(ctx: ReturnType<typeof contextWith>, assetId: string, hex: string): void {
  const key = `phash:${hex}`;
  ctx.identity.set(key, (ctx.identity.get(key) ?? new Set()).add(assetId));
}

describe('near-duplicate clustering in finalize', () => {
  it('groups 200 identical hashes into at most 4 suggestions of 50, quickly', async () => {
    const hashes = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [id(i), SAME]));
    const ctx = contextWith(hashes);
    const started = performance.now();
    await plugin.finalize!(ctx);
    expect(performance.now() - started).toBeLessThan(1000);
    const suggestions = ctx.recorded.suggestions;
    expect(suggestions.length).toBeLessThanOrEqual(4);
    for (const s of suggestions) {
      expect(s.assetIds.length).toBeLessThanOrEqual(50);
      expect(s.assetIds).toEqual([...s.assetIds].sort());
      expect(s).toMatchObject({ kind: 'near', confidence: 1 });
    }
    expect(new Set(suggestions.flatMap((s) => s.assetIds)).size).toBe(200);
  });

  it('makes one suggestion per separate cluster', async () => {
    const ctx = contextWith({ a: SAME, b: SAME, c: SAME, x: OTHER, y: OTHER });
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions.map((s) => s.assetIds)).toEqual([
      ['a', 'b', 'c'],
      ['x', 'y'],
    ]);
  });

  it('suggests only the new member with one existing member when a cluster grows', async () => {
    const ctx = contextWith({ a: SAME, b: SAME, c: SAME });
    await plugin.finalize!(ctx);
    addHash(ctx, 'd', SAME);
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions.map((s) => s.assetIds)).toEqual([
      ['a', 'b', 'c'],
      ['a', 'd'],
    ]);
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toHaveLength(2);
  });

  it('uses the largest distance inside a cluster for confidence', async () => {
    const ctx = contextWith({
      a: '0000000000000000',
      b: '0000000000000003',
      c: '000000000000000f',
    });
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toEqual([
      { assetIds: ['a', 'b', 'c'], kind: 'near', confidence: 1 - 4 / 64 },
    ]);
  });

  it('applies burst protection per pair before grouping', async () => {
    const ctx = contextWith({});
    const shots: [string, string, string][] = [
      ['b1', '0000000000000000', '2026-05-01T10:00:00'],
      ['b2', '0000000000000001', '2026-05-01T10:00:01'],
    ];
    const assets: AssetView[] = shots.map(([assetId, , capturedAt]) => ({
      id: assetId,
      kind: 'image',
      capturedAt,
      instances: [],
      enrichments: {},
    }));
    for (const [i, [assetId, hex]] of shots.entries()) {
      addHash(ctx, assetId, hex);
      await nearIndex.append(ctx.dataDir, {
        assetId,
        phash: hex,
        capturedAt: assets[i]!.capturedAt,
      });
    }
    await plugin.finalize!(ctx);
    expect(ctx.recorded.suggestions).toEqual([]);
  });
});

describe('clustering helpers', () => {
  it('limits neighbours per asset but keeps groups of close hashes connected', () => {
    const hashed = Array.from({ length: 1000 }, (_, i) => ({
      assetId: id(i),
      hash: { hi: 0, lo: i % 3 },
    }));
    const pairs = nearPairs(hashed, 6);
    expect(pairs.length).toBeLessThanOrEqual(1000 * 22);
    expect(clusters(pairs)).toHaveLength(1);
    expect(clusters(pairs)[0]!.ids).toHaveLength(1000);
  });

  it('splits into even chunks without a lone asset', () => {
    const ids = Array.from({ length: 51 }, (_, i) => id(i));
    expect(balancedChunks(ids, 50).map((c) => c.length)).toEqual([26, 25]);
    expect(balancedChunks(ids.slice(0, 50), 50).map((c) => c.length)).toEqual([50]);
  });

  it('does not repeat a chunked cluster', () => {
    const pairs = Array.from({ length: 59 }, (_, i) => ({ a: id(0), b: id(i + 1), distance: 0 }));
    const [cluster] = clusters(pairs);
    const first = planGroups(cluster!, new SuggestedMemory([]));
    expect(first.map((g) => g.length)).toEqual([30, 30]);
    expect(planGroups(cluster!, new SuggestedMemory(first))).toEqual([]);
  });

  it('anchors more than 49 new members to the same existing member in every chunk', () => {
    const pairs = Array.from({ length: 60 }, (_, i) => ({ a: id(0), b: id(i + 1), distance: 1 }));
    const [cluster] = clusters(pairs);
    const groups = planGroups(cluster!, new SuggestedMemory([[id(0), 'old']]));
    expect(groups.map((g) => g.length)).toEqual([31, 31]);
    for (const group of groups) expect(group).toContain(id(0));
  });
});
