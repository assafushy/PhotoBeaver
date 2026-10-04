import path from 'node:path';
import localConnector from '@photobeaver/connector-local';
import localManifest from '@photobeaver/connector-local/manifest' with { type: 'json' };
import ffmpegPath from 'ffmpeg-static';
import { ConnectorRegistry } from '../../src/main/core/connectors/registry';
import type { ConnectorManifest } from '../../src/main/core/connectors/manifest';
import { nullEventSink } from '../../src/main/core/events/event-sink';
import { JobQueue } from '../../src/main/core/jobs/job-queue';
import type { JobRow } from '../../src/main/core/jobs/job-types';
import { OriginalCache } from '../../src/main/core/originals/original-cache';
import { OriginalSource } from '../../src/main/core/originals/original-source';
import { BatchWriter } from '../../src/main/core/sync/batch-writer';
import { SyncRunner } from '../../src/main/core/sync/sync-runner';
import { ThumbnailService } from '../../src/main/core/thumbnails/thumbnail-service';
import { insertSource, silentCoreLog, testRegistryDeps, type TempLibrary } from './helpers';

export const LOCAL_ID = 'com.photobeaver.connector-local';

/**
 * Wires the sync runner and thumbnail service with connector-local for a temp library.
 *
 * @param temp - Temp library.
 * @returns Helpers to sync a folder and drain thumbnail jobs.
 */
export function localHarness(temp: TempLibrary) {
  const db = temp.library.db;
  const entry = { manifest: localManifest as ConnectorManifest, plugin: localConnector as never };
  const registry = new ConnectorRegistry(
    [entry],
    testRegistryDeps(temp, path.join(temp.dir, 'pd')),
  );
  registry.registerBuiltins(0);
  const queue = new JobQueue(temp.library.sqlite);
  const source = new OriginalSource(db, registry);
  const ready: string[] = [];
  const thumbs = new ThumbnailService({
    db,
    thumbsDir: path.join(temp.dir, 'thumbs'),
    source,
    cache: new OriginalCache(path.join(temp.dir, 'cache'), source),
    ffmpegPath: ffmpegPath as unknown as string,
    logger: silentCoreLog,
    onReady: (update) => ready.push(update.id),
  });
  const runner = new SyncRunner({
    db,
    writer: new BatchWriter(db, queue),
    registry,
    events: nullEventSink,
    logger: silentCoreLog,
  });
  const signal = new AbortController().signal;
  return {
    queue,
    thumbs,
    ready,
    addSource: (id: string, root: string) =>
      insertSource(temp, { id, pluginId: LOCAL_ID, config: { root } }),
    sync: (sourceId: string) => runner.run({ job: { source_id: sourceId } as JobRow, signal }),
    async drainThumbnails(): Promise<void> {
      for (
        let job = queue.lease(['thumbnail'], 't', 60_000);
        job;
        job = queue.lease(['thumbnail'], 't', 60_000)
      ) {
        await thumbs.run({ job, signal });
        queue.complete(job.id);
      }
    },
  };
}
