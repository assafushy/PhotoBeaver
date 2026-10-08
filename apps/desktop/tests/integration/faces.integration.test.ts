import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import localConnector from '@photobeaver/connector-local';
import localManifest from '@photobeaver/connector-local/manifest' with { type: 'json' };
import type { AssetView, EnricherPlugin } from '@photobeaver/plugin-sdk';
import { validateManifest } from '@photobeaver/shared/manifest';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectorManifest } from '../../src/main/core/connectors/manifest';
import { Core } from '../../src/main/core/core';
import { inProcessEnricher, type EnricherManifest } from '../../src/main/core/enrich/types';
import { writeImageSet } from '../fixtures/generate';
import { openTempLibrary, silentCoreLog, type TempLibrary } from '../unit/helpers';

const FACES = 'com.example.fake-faces';

function embeddingFor(filename: string): number[] {
  const index = Number(/(\d+)\.jpg$/.exec(filename)?.[1] ?? 0);
  const group = (index % 2) + 1;
  const v = new Array<number>(512).fill(0);
  v[group] = 1;
  v[100 + (index % 5)] = 0.1;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

const fakeFaces: EnricherPlugin = {
  enrich: async (_ctx, asset: AssetView) => {
    const name = asset.instances[0]?.filename ?? '';
    return {
      faces: [
        {
          bbox: { x: 0.3, y: 0.2, w: 0.3, h: 0.4 },
          confidence: 0.95,
          embedding: embeddingFor(name),
        },
      ],
    };
  },
};

function fakeManifest(): EnricherManifest {
  const result = validateManifest({
    id: FACES,
    name: 'Fake faces',
    version: '1.0.0',
    type: 'enricher',
    apiVersion: '1',
    main: 'dist/index.js',
    enricher: { accepts: ['image/*'], input: 'metadata', produces: ['faces'] },
  });
  if (!result.ok) throw new Error(result.errors.join());
  return result.manifest as unknown as EnricherManifest;
}

describe('faces and people in the headless core', () => {
  let temp: TempLibrary;
  let root: string;
  let core: Core;
  const sqlite = () => temp.library.sqlite;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'pb-faces-int-'));
    await writeImageSet(root, 6);
    temp = await openTempLibrary();
    core = new Core({
      library: temp.library,
      libraryDir: temp.dir,
      pluginDataRoot: path.join(temp.dir, 'plugin-data'),
      connectors: [
        { manifest: localManifest as ConnectorManifest, plugin: localConnector as never },
      ],
      enrichers: [{ manifest: fakeManifest(), client: inProcessEnricher(fakeFaces as never) }],
      events: { emit: () => undefined },
      logger: silentCoreLog,
      ffmpegPath: ffmpegPath as unknown as string,
      pickDirectory: async () => null,
    });
    core.start();
    await core.sources.add(
      { pluginId: 'com.photobeaver.connector-local', config: { root } },
      'admin',
    );
    await vi.waitFor(() => expect(core.people.list(null)).toHaveLength(2), {
      timeout: 60_000,
      interval: 250,
    });
  }, 90_000);

  afterAll(async () => {
    await core.stop();
    temp.cleanup();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('stores faces with embeddings and groups them into people through the clustering job', () => {
    const faces = sqlite().prepare('SELECT COUNT(*) n FROM faces').get() as { n: number };
    const vectors = sqlite().prepare('SELECT COUNT(*) n FROM faces_vec').get() as { n: number };
    expect(faces.n).toBe(6);
    expect(vectors.n).toBe(6);
    expect(core.people.list(null).map((p) => p.faceCount)).toEqual([3, 3]);
  });

  it('makes a named person searchable', () => {
    const [person] = core.people.list(null);
    core.people.rename(person!.id, 'Grace Hopper', null);
    const hits = sqlite()
      .prepare("SELECT COUNT(*) n FROM assets_fts WHERE assets_fts MATCH 'hopper'")
      .get() as { n: number };
    expect(hits.n).toBe(person!.assetCount);
  });
});
