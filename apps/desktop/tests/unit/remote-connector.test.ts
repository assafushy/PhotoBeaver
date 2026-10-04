import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import localConnector from '@photobeaver/connector-local';
import localManifest from '@photobeaver/connector-local/manifest' with { type: 'json' };
import type { ConnectorPlugin, SyncBatch, SyncContext } from '@photobeaver/plugin-sdk';
import type { ConfigSchema } from '@photobeaver/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CallContexts } from '../../src/main/core/plugins/call-contexts';
import { registerCoreHandlers } from '../../src/main/core/plugins/core-handlers';
import {
  isHostCrashedError,
  PluginUnavailableError,
} from '../../src/main/core/plugins/host-errors';
import { HostHandle } from '../../src/main/core/plugins/host-handle';
import { grantedDirsOf, RemoteConnector } from '../../src/main/core/plugins/remote-connector';
import { makeTree } from '../../../../plugins/connector-local/tests/helpers';
import { silentCoreLog } from './helpers';
import { MemoryLauncher, testHostInit } from './memory-launcher';

const ID = 'com.photobeaver.connector-local';
const schema = localManifest.configSchema as ConfigSchema;

function setup(plugin: ConnectorPlugin<unknown> = localConnector as never) {
  const contexts = new CallContexts();
  const launcher = new MemoryLauncher(plugin);
  const memory = new Map<string, unknown>();
  const handle = new HostHandle({
    pluginId: ID,
    launcher,
    launchOptions: { pluginId: ID, maxOldSpaceMb: 1024, logFile: '' },
    init: testHostInit(ID),
    registerCoreHandlers: (peer) =>
      registerCoreHandlers(peer, {
        contexts,
        storage: {
          get: async (k) => memory.get(k) as never,
          set: async (k, v) => void memory.set(k, v),
          delete: async (k) => void memory.delete(k),
        },
        pluginLog: silentCoreLog,
        settings: async () => ({}),
      }),
    onStarted: () => undefined,
    onCrashed: () => undefined,
    logger: silentCoreLog,
  });
  return { handle, launcher, remote: new RemoteConnector(handle, contexts, schema) };
}

function syncCtx(
  root: string,
  known: Record<string, { etag?: string }> = {},
  asked: string[][] = [],
): SyncContext<unknown> {
  const noop = () => undefined;
  return {
    pluginId: ID,
    sourceId: 's1',
    config: { root },
    dataDir: root,
    signal: new AbortController().signal,
    fetch,
    log: { debug: noop, info: noop, warn: noop, error: noop },
    storage: {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
    settings: async <T>() => ({}) as T,
    secret: { get: async () => undefined, set: async () => undefined },
    oauth: {
      authorize: async () => ({ accessToken: '' }),
      refresh: async () => ({ accessToken: '' }),
    },
    ui: { pickDirectory: async () => null, notify: noop },
    reportProgress: noop,
    isKnown: async (ids) => (
      asked.push(ids),
      Object.fromEntries(ids.filter((i) => known[i]).map((i) => [i, known[i]!]))
    ),
  };
}

async function collect(batches: AsyncIterable<SyncBatch>): Promise<SyncBatch[]> {
  const out: SyncBatch[] = [];
  for await (const batch of batches) out.push(batch);
  return out;
}

describe('RemoteConnector over the host runtime', () => {
  let tree: ReturnType<typeof makeTree>;

  beforeEach(() => {
    tree = makeTree(['a/1.jpg', 'b.png', 'notes.txt']);
  });

  afterEach(() => tree.cleanup());

  it('streams sync batches and routes isKnown back to the core context', async () => {
    const { remote, launcher } = setup();
    const asked: string[][] = [];
    const batches = await collect(remote.sync(syncCtx(tree.root, {}, asked), null));
    expect(batches.flatMap((b) => b.upserts ?? []).map((i) => i.filename)).toEqual([
      '1.jpg',
      'b.png',
    ]);
    expect(batches.at(-1)?.isFullScan).toBe(true);
    expect(asked.flat()).toHaveLength(2);
    expect(launcher.launches).toBe(1);
  });

  it('streams original bytes across 1 MB chunks', async () => {
    const big = randomBytes(2.5 * 1024 * 1024);
    writeFileSync(path.join(tree.root, 'big.jpg'), big);
    const { remote } = setup();
    const stream = await remote.getOriginal(syncCtx(tree.root), {
      sourceId: 's1',
      externalId: path.join(tree.root, 'big.jpg'),
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(bytes.equals(big)).toBe(true);
  });

  it('returns null thumbnails when the connector has none', async () => {
    const { remote } = setup();
    expect(
      await remote.getThumbnail(syncCtx(tree.root), { sourceId: 's1', externalId: 'x' }, 256),
    ).toBeNull();
  });

  it('surfaces a host crash as HostCrashedError and restarts on the next call', async () => {
    const { remote, launcher } = setup();
    const iterator = remote.sync(syncCtx(tree.root), null)[Symbol.asyncIterator]();
    await iterator.next();
    launcher.current!.kill();
    const error = await iterator.next().catch((e: unknown) => e);
    expect(isHostCrashedError(error)).toBe(true);
    expect((error as { retryAfterMs: number }).retryAfterMs).toBeGreaterThanOrEqual(1000);
    const batches = await collect(remote.sync(syncCtx(tree.root), null));
    expect(batches.flatMap((b) => b.upserts ?? [])).toHaveLength(2);
    expect(launcher.launches).toBe(2);
  }, 10_000);

  it('gives up after 5 crashes in 10 minutes', async () => {
    const { handle, launcher } = setup();
    for (let i = 0; i < 4; i++) handle.crashes.record(Date.now());
    await handle.connect();
    launcher.current!.kill();
    await new Promise((r) => setTimeout(r, 10));
    expect(handle.hasCrashedTooOften).toBe(true);
    await expect(handle.connect()).rejects.toBeInstanceOf(PluginUnavailableError);
  });

  it('computes granted folders from directory config fields', () => {
    expect(grantedDirsOf(schema, { root: '/photos', includeVideos: true })).toEqual(['/photos']);
    expect(grantedDirsOf(schema, {})).toEqual([]);
  });
});
