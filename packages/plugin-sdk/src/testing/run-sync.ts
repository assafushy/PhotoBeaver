import type { ConnectorPlugin } from '../connector';
import type { KnownItemState } from '../context';
import type { MediaItem, SyncBatch } from '../media';
import { createFakeSyncContext, type FakeContextOptions, type FakeRecorder } from './fake-context';

export interface RunSyncOptions<Config> {
  config: Config;
  cursor?: string | null;
  known?: Record<string, KnownItemState>;
  context?: Omit<FakeContextOptions, 'known'>;
}

export interface RunSyncResult {
  batches: SyncBatch[];
  items: MediaItem[];
  deletes: string[];
  finalCursor: string | null;
  recorded: FakeRecorder;
}

/**
 * Runs one sync of a connector against a fake host and collects every batch.
 *
 * @param plugin - The connector under test.
 * @param options - Config, starting cursor (null for a full scan) and known items.
 * @returns All batches, the flattened upserts and deletes, and the last cursor.
 */
export async function runSync<Config>(
  plugin: ConnectorPlugin<Config>,
  options: RunSyncOptions<Config>,
): Promise<RunSyncResult> {
  const ctx = createFakeSyncContext(options.config, { ...options.context, known: options.known });
  const start = options.cursor ?? null;
  const batches: SyncBatch[] = [];
  for await (const batch of plugin.sync(ctx, start)) batches.push(batch);
  return {
    batches,
    items: batches.flatMap((batch) => batch.upserts ?? []),
    deletes: batches.flatMap((batch) => batch.deletes ?? []),
    finalCursor: batches.at(-1)?.cursor ?? start,
    recorded: ctx.recorded,
  };
}
