import type { ConnectorPlugin, MediaItem, SyncBatch } from '@photobeaver/plugin-sdk';
import type { ConnectorEntry } from '../../src/main/core/connectors/registry';

export interface FakeFile {
  id: string;
  etag: string;
  filename?: string;
}

export interface FakeSource {
  files: FakeFile[];
  batchSize: number;
  failAfterBatches?: number;
  failWith?: Error;
  useIsKnown?: boolean;
}

function toItem(file: FakeFile): MediaItem {
  return {
    externalId: file.id,
    kind: 'image',
    mime: 'image/jpeg',
    filename: file.filename ?? `${file.id}.jpg`,
    etag: file.etag,
    modifiedAt: '2024-05-01T10:00:00.000Z',
  };
}

async function* scan(
  state: FakeSource,
  start: number,
  isKnown: (ids: string[]) => Promise<Record<string, { etag?: string }>>,
): AsyncGenerator<SyncBatch> {
  let emitted = 0;
  for (let i = start; i < state.files.length; i += state.batchSize) {
    if (state.failAfterBatches !== undefined && emitted >= state.failAfterBatches)
      throw state.failWith ?? new Error('crash');
    const chunk = state.files.slice(i, i + state.batchSize);
    const known = state.useIsKnown ? await isKnown(chunk.map((f) => f.id)) : {};
    const upserts = chunk.filter((f) => known[f.id]?.etag !== f.etag).map(toItem);
    emitted++;
    yield { upserts, cursor: String(i + chunk.length), progress: { done: i + chunk.length } };
  }
  yield { upserts: [], cursor: 'done', isFullScan: true };
}

/**
 * A scripted full-scan connector with a numeric resume cursor, for core tests.
 *
 * @param state - Mutable files and failure injection.
 * @returns A registry entry.
 */
export function fakeConnector(state: FakeSource): ConnectorEntry {
  const plugin: ConnectorPlugin<unknown> = {
    setupSource: async () => ({ displayName: 'Fake' }),
    sync: (ctx, cursor) =>
      scan(state, cursor && cursor !== 'done' ? Number(cursor) : 0, ctx.isKnown),
    getOriginal: async () => new Blob(['x']).stream() as ReadableStream<Uint8Array>,
  };
  const manifest = {
    id: 'fake',
    name: 'Fake',
    version: '1.0.0',
    type: 'connector' as const,
    apiVersion: '1',
    connector: { syncModes: ['poll' as const], defaultIntervalSec: 3600 },
  };
  return { manifest, plugin };
}
