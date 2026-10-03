import { defineConnector, type MediaItem, type SyncBatch } from '../src';

export interface MemoryConfig {
  items: MediaItem[];
  batchSize: number;
  brokenCursor?: boolean;
  unstableIds?: boolean;
  ignoreKnown?: boolean;
  forgetDeletes?: boolean;
}

let generation = 0;

function withId(item: MediaItem, config: MemoryConfig): MediaItem {
  return config.unstableIds ? { ...item, externalId: `${item.externalId}-${generation}` } : item;
}

function batchAt(config: MemoryConfig, items: MediaItem[], start: number): SyncBatch {
  const end = start + config.batchSize;
  return {
    upserts: items.slice(start, end),
    cursor: config.brokenCursor ? 'start' : String(end),
  };
}

/**
 * Builds the config for the in-memory connector, whose behavior can be broken on purpose.
 *
 * @param base - Starting items.
 * @param batchSize - Upserts per batch.
 * @returns A mutable connector config.
 */
export function memoryConfig(base: MediaItem[], batchSize: number): MemoryConfig {
  return { items: [...base], batchSize };
}

/**
 * Makes N image items with stable ids and etags.
 *
 * @param count - Number of items.
 * @returns Items.
 */
export function makeItems(count: number): MediaItem[] {
  return Array.from({ length: count }, (_, i) => ({
    externalId: `item-${i}`,
    kind: 'image' as const,
    etag: `etag-${i}`,
  }));
}

export default defineConnector<MemoryConfig>({
  async setupSource() {
    return { displayName: 'Memory' };
  },
  async *sync(ctx, cursor) {
    generation++;
    const known = ctx.config.ignoreKnown
      ? {}
      : await ctx.isKnown(ctx.config.items.map((i) => i.externalId));
    const items = ctx.config.items
      .filter((item) => known[item.externalId]?.etag !== item.etag)
      .map((item) => withId(item, ctx.config));
    for (let start = Number(cursor ?? 0); start < items.length; start += ctx.config.batchSize) {
      yield batchAt(ctx.config, items, start);
    }
    yield { upserts: [], cursor: 'done', isFullScan: !ctx.config.forgetDeletes };
  },
  async getOriginal() {
    return new ReadableStream<Uint8Array>({ start: (c) => c.close() });
  },
});
