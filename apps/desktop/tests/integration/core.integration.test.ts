import { copyFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import localConnector from '@photobeaver/connector-local';
import localManifest from '@photobeaver/connector-local/manifest' with { type: 'json' };
import { schema } from '@photobeaver/db';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectorManifest } from '../../src/main/core/connectors/manifest';
import { Core } from '../../src/main/core/core';
import { queryLibraryPage } from '../../src/main/library/library-service';
import { writeImage, writeImageSet, writeVideo } from '../fixtures/generate';
import { openTempLibrary, silentCoreLog, type TempLibrary } from '../unit/helpers';

const IMAGE_COUNT = 300;

describe('core headless integration with connector-local', () => {
  let temp: TempLibrary;
  let root: string;
  let core: Core;
  let files: string[];
  const events: string[] = [];

  const visible = () =>
    queryLibraryPage(temp.library.db, { cursor: null, limit: 1000 }, null).total;
  const pendingThumbs = () =>
    temp.library.db
      .select()
      .from(schema.assets)
      .all()
      .filter((a) => a.thumbState === 'pending').length;
  const source = () => core.sources.list(null)[0]!;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'pb-int-'));
    files = await writeImageSet(root, IMAGE_COUNT, 100);
    await writeImage(root, {
      file: 'nested/deep/rotated.jpg',
      width: 80,
      height: 40,
      orientation: 6,
    });
    copyFileSync(path.join(root, files[0]!), path.join(root, 'nested/copy-of-first.jpg'));
    await writeVideo(root, 'videos/clip.mp4', 1);
    temp = await openTempLibrary();
    core = new Core({
      library: temp.library,
      libraryDir: temp.dir,
      pluginDataRoot: path.join(temp.dir, 'plugin-data'),
      connectors: [
        { manifest: localManifest as ConnectorManifest, plugin: localConnector as never },
      ],
      events: { emit: (name) => void events.push(name) },
      logger: silentCoreLog,
      ffmpegPath: ffmpegPath as unknown as string,
      pickDirectory: async () => null,
    });
    core.start();
  });

  afterAll(async () => {
    await core.stop();
    temp.cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  it('indexes every file and generates every thumbnail', async () => {
    await core.sources.add(
      { pluginId: 'com.photobeaver.connector-local', config: { root } },
      'admin',
    );
    await vi.waitFor(() => expect(source().syncState).toBe('idle'), {
      timeout: 30_000,
      interval: 100,
    });
    expect(visible()).toBe(IMAGE_COUNT + 3);
    expect(source().itemCount).toBe(IMAGE_COUNT + 3);
    await vi.waitFor(() => expect(pendingThumbs()).toBe(0), { timeout: 30_000, interval: 200 });
    const assets = temp.library.db.select().from(schema.assets).all();
    expect(assets.filter((a) => a.thumbState === 'ready')).toHaveLength(IMAGE_COUNT + 3);
    expect(assets.filter((a) => a.capturedAtSource === 'filename')).toHaveLength(IMAGE_COUNT);
    expect(events).toContain('library.changed');
    expect(events).toContain('thumbs.ready');
  });

  it('removes a deleted file from the library after the next sync', async () => {
    unlinkSync(path.join(root, files[5]!));
    core.sources.syncNow(source().id);
    await vi.waitFor(() => expect(visible()).toBe(IMAGE_COUNT + 2), {
      timeout: 30_000,
      interval: 100,
    });
  });

  it('removes all assets when the source is removed', async () => {
    await vi.waitFor(() => expect(source().syncState).toBe('idle'), {
      timeout: 30_000,
      interval: 100,
    });
    await core.sources.remove(source().id, 'admin');
    expect(visible()).toBe(0);
    expect(temp.library.db.select().from(schema.assets).all()).toHaveLength(0);
    const audit = temp.library.db
      .select()
      .from(schema.auditLog)
      .all()
      .map((r) => r.action);
    expect(audit).toEqual(['source.add', 'source.remove']);
  });
});
