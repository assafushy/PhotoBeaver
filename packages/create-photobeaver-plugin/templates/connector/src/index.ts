import { defineConnector, type MediaItem, type SyncContext } from '@photobeaver/plugin-sdk';

export interface Config {
  items?: MediaItem[];
}

export const BATCH_SIZE = 500;
const COMPLETE = 'complete';

export const sampleItems: MediaItem[] = [
  {
    externalId: 'sample-1',
    kind: 'image',
    mime: 'image/jpeg',
    filename: 'sunrise.jpg',
    etag: 'v1',
  },
  {
    externalId: 'sample-2',
    kind: 'image',
    mime: 'image/jpeg',
    filename: 'harbor.jpg',
    etag: 'v1',
  },
];

function startOffset(cursor: string | null): number {
  const offset = Number.parseInt(cursor ?? '', 10);
  return Number.isNaN(offset) ? 0 : offset;
}

async function changedItems(ctx: SyncContext<Config>): Promise<MediaItem[]> {
  const items = ctx.config.items ?? sampleItems;
  const known = await ctx.isKnown(items.map((item) => item.externalId));
  return items.filter((item) => known[item.externalId]?.etag !== item.etag);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export default defineConnector<Config>({
  async setupSource() {
    return { displayName: '{{name}}' };
  },

  async *sync(ctx, cursor) {
    const items = await changedItems(ctx);
    for (let start = startOffset(cursor); start < items.length; start += BATCH_SIZE) {
      ctx.signal.throwIfAborted();
      const end = start + BATCH_SIZE;
      yield { upserts: items.slice(start, end), cursor: String(end) };
    }
    yield { upserts: [], cursor: COMPLETE, isFullScan: true };
  },

  async getOriginal(_ctx, item) {
    return streamOf(new TextEncoder().encode(`Sample bytes for ${item.externalId}`));
  },
});
