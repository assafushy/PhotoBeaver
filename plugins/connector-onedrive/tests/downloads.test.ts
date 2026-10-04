import { describe, expect, it } from 'vitest';
import { createFakeSourceContext } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { thumbnailSizeName } from '../src/downloads';
import { DOWNLOAD_HOST, FakeGraph, GRAPH_HOST, graphContext, seedLibrary } from './fake-graph';

function setup() {
  const graph = new FakeGraph();
  seedLibrary(graph);
  const ctx = createFakeSourceContext({}, graphContext(graph));
  return { graph, ctx };
}

const ref = (externalId: string) => ({ sourceId: 'test-source', externalId });

const text = (stream: ReadableStream<Uint8Array> | null) => new Response(stream).text();

describe('getOriginal', () => {
  it('downloads from the pre-authenticated URL without the access token', async () => {
    const { graph, ctx } = setup();
    expect(await text(await connector.getOriginal(ctx, ref('p1')))).toBe('bytes of /download/p1');
    const download = graph.requests.find((request) => request.url.hostname === DOWNLOAD_HOST)!;
    expect(download.authorization).toBeNull();
    const lookup = graph.requests.find((request) => request.url.hostname === GRAPH_HOST)!;
    expect(lookup.authorization).toBe('Bearer access-1');
  });

  it('fails for an item that is gone', async () => {
    const { graph, ctx } = setup();
    graph.remove('p1');
    await expect(connector.getOriginal(ctx, ref('p1'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('getThumbnail', () => {
  it('picks a standard size or a custom bounding box', () => {
    expect(thumbnailSizeName(96)).toBe('medium');
    expect(thumbnailSizeName(256)).toBe('large');
    expect(thumbnailSizeName(1024)).toBe('c1024x1024');
  });

  it('streams the thumbnail without the access token', async () => {
    const { graph, ctx } = setup();
    expect(await text(await connector.getThumbnail!(ctx, ref('p1'), 256))).toBe(
      'bytes of /thumb/p1/large',
    );
    const download = graph.requests.find((request) => request.url.hostname === DOWNLOAD_HOST)!;
    expect(download.authorization).toBeNull();
  });

  it('falls back to large when a custom size is unavailable', async () => {
    const { graph, ctx } = setup();
    graph.customThumbnails = false;
    expect(await text(await connector.getThumbnail!(ctx, ref('p1'), 1600))).toBe(
      'bytes of /thumb/p1/large',
    );
  });

  it('returns null when OneDrive has no thumbnail', async () => {
    const { ctx } = setup();
    expect(await connector.getThumbnail!(ctx, ref('missing'), 256)).toBeNull();
  });
});
