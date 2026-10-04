import { describe, expect, it } from 'vitest';
import type { SyncBatch } from '@photobeaver/plugin-sdk';
import { createFakeSyncContext, runSync } from '@photobeaver/plugin-sdk/testing';
import connector, { type OneDriveConfig } from '../src';
import { FakeGraph, graphContext, seedLibrary } from './fake-graph';

async function collect(batches: AsyncIterable<SyncBatch>): Promise<SyncBatch[]> {
  const result: SyncBatch[] = [];
  for await (const batch of batches) result.push(batch);
  return result;
}

function setup() {
  const graph = new FakeGraph();
  const media = seedLibrary(graph);
  const sync = (
    cursor: string | null,
    config: OneDriveConfig = {},
    context = graphContext(graph),
  ) => runSync(connector, { config, cursor, context });
  return { graph, media, sync };
}

describe('delta sync', () => {
  it('pages a full scan and marks only the last batch as a full scan', async () => {
    const { media, sync } = setup();
    const { batches, items } = await sync(null);
    expect(items.map((item) => item.externalId).sort()).toEqual([...media].sort());
    expect(batches.length).toBeGreaterThan(2);
    expect(batches.slice(0, -1).every((batch) => !batch.isFullScan)).toBe(true);
    expect(batches.at(-1)!.isFullScan).toBe(true);
    expect(batches.at(-1)!.cursor).toContain('token=');
    expect(batches[0]!.cursor).toContain('skip=');
  });

  it('asks Graph only for the fields it needs', async () => {
    const { graph, sync } = setup();
    await sync(null);
    const first = graph.requests.find((request) => request.url.pathname.endsWith('/delta'))!;
    expect(first.url.searchParams.get('$select')).toContain('photo');
  });

  it('continues from a deltaLink with changes and deletes, not as a full scan', async () => {
    const { graph } = setup();
    const ctx = createFakeSyncContext({}, graphContext(graph));
    const first = await collect(connector.sync(ctx, null));
    graph.touch('p2');
    graph.remove('p4');
    graph.addFile({ id: 'p9', name: 'new.jpg', parentId: 'f-2024', facets: { photo: {} } });
    const next = await collect(connector.sync(ctx, first.at(-1)!.cursor));
    const upserts = next.flatMap((batch) => batch.upserts ?? []);
    expect(upserts.map((item) => item.externalId).sort()).toEqual(['p2', 'p9']);
    expect(upserts.find((item) => item.externalId === 'p9')!.path).toBe('Pictures/2024');
    expect(next.flatMap((batch) => batch.deletes ?? [])).toEqual(['p4']);
    expect(next.some((batch) => batch.isFullScan)).toBe(false);
  });

  it('reports the files of a deleted folder as deleted', async () => {
    const { graph, sync } = setup();
    const first = await sync(null);
    graph.remove('f-2024');
    const next = await sync(first.finalCursor);
    expect(next.deletes.sort()).toEqual(['p1', 'v1']);
  });

  it('restarts as a full scan when the delta token has expired (410)', async () => {
    const { graph, media, sync } = setup();
    const first = await sync(null);
    graph.expireDeltaTokens();
    const next = await sync(first.finalCursor);
    expect(next.items.map((item) => item.externalId).sort()).toEqual([...media].sort());
    expect(next.batches.at(-1)!.isFullScan).toBe(true);
    expect(next.recorded.logs.some((line) => line.level === 'warn')).toBe(true);
  });

  it('syncs only the configured folder', async () => {
    const { graph, sync } = setup();
    const { items } = await sync(null, { folder: 'Pictures/2024' });
    expect(items.map((item) => item.externalId).sort()).toEqual(['p1', 'v1']);
    expect(items[0]!.path).toBe('Pictures/2024');
    const delta = graph.requests.find((request) => request.url.pathname.endsWith('/delta'))!;
    expect(delta.url.pathname).toBe('/v1.0/me/drive/root:/Pictures/2024:/delta');
  });

  it('skips items whose etag core already has', async () => {
    const { sync, graph } = setup();
    const first = await sync(null);
    const known = Object.fromEntries(first.items.map((i) => [i.externalId, { etag: i.etag }]));
    graph.touch('p3');
    const again = await runSync(connector, { config: {}, known, context: graphContext(graph) });
    expect(again.items.map((item) => item.externalId)).toEqual(['p3']);
  });

  it('reports progress', async () => {
    const { sync } = setup();
    const { recorded } = await sync(null);
    expect(recorded.progress.at(-1)!.done).toBeGreaterThan(5);
  });
});

describe('auth and throttling', () => {
  it('refreshes an expired access token once and saves the new tokens', async () => {
    const { graph, media, sync } = setup();
    graph.expireAccessTokens();
    const { items, recorded } = await sync(null);
    expect(items).toHaveLength(media.length);
    expect(recorded.secret).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    expect(recorded.oauth.filter((call) => call.kind === 'refresh')).toHaveLength(1);
    expect(recorded.oauth[0]!.options).toMatchObject({ clientId: 'c', refreshToken: 'refresh-1' });
  });

  it('asks for reconnecting when the refresh is rejected', async () => {
    const { graph, sync } = setup();
    graph.expireAccessTokens();
    const context = { ...graphContext(graph), secret: { accessToken: 'old' } };
    await expect(sync(null, {}, context)).rejects.toMatchObject({ name: 'AuthRequiredError' });
  });

  it('turns a 429 into RateLimitedError with Retry-After', async () => {
    const { graph, sync } = setup();
    graph.throttleNext(1, 42);
    await expect(sync(null)).rejects.toMatchObject({
      name: 'RateLimitedError',
      retryAfterSec: 42,
    });
  });

  it('fails clearly when the client ID was removed from settings', async () => {
    const { graph, sync } = setup();
    const context = { ...graphContext(graph), settings: {} };
    await expect(sync(null, {}, context)).rejects.toThrow('application ID');
  });
});
