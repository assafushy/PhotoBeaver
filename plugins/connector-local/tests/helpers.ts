import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { KnownItemState, SyncBatch, SyncContext } from '@photobeaver/plugin-sdk';
import type { LocalConfig } from '../src';

const noop = (): void => undefined;

/**
 * Creates a temp folder containing the given relative files.
 *
 * @param files - Relative paths to create (parent folders are created).
 * @returns The root and a cleanup function.
 */
export function makeTree(files: string[]): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'pb-local-'));
  for (const file of files) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `content of ${file}`);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Builds a minimal SyncContext backed by an in-memory known-items map.
 *
 * @param config - Connector config.
 * @param known - externalId to known state.
 * @returns A sync context for tests.
 */
export function fakeSyncContext(
  config: LocalConfig,
  known: Record<string, KnownItemState> = {},
): SyncContext<LocalConfig> {
  const log = { debug: noop, info: noop, warn: noop, error: noop };
  return {
    pluginId: 'com.photobeaver.connector-local',
    sourceId: 'source-1',
    config,
    log,
    dataDir: tmpdir(),
    signal: new AbortController().signal,
    fetch: globalThis.fetch,
    settings: async <T>() => ({}) as T,
    storage: {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    },
    secret: { get: async () => undefined, set: async () => undefined },
    oauth: {
      authorize: async () => ({ accessToken: '' }),
      refresh: async () => ({ accessToken: '' }),
    },
    ui: { pickDirectory: async () => null, notify: noop, openExternal: async () => undefined },
    status: noop,
    reportProgress: noop,
    isKnown: async (ids) =>
      Object.fromEntries(ids.filter((id) => known[id]).map((id) => [id, known[id]!])),
  };
}

/**
 * Collects every batch from an async iterable.
 *
 * @param batches - The sync iterator.
 * @returns All batches.
 */
export async function collect(batches: AsyncIterable<SyncBatch>): Promise<SyncBatch[]> {
  const result: SyncBatch[] = [];
  for await (const batch of batches) result.push(batch);
  return result;
}
