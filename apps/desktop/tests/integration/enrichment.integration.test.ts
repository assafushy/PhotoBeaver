import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import localConnector from '@photobeaver/connector-local';
import localManifest from '@photobeaver/connector-local/manifest' with { type: 'json' };
import dedup from '@photobeaver/enricher-dedup';
import dedupManifest from '@photobeaver/enricher-dedup/manifest' with { type: 'json' };
import geocode from '@photobeaver/enricher-geocode';
import geocodeManifest from '@photobeaver/enricher-geocode/manifest' with { type: 'json' };
import metadata from '@photobeaver/enricher-metadata';
import metadataManifest from '@photobeaver/enricher-metadata/manifest' with { type: 'json' };
import { schema } from '@photobeaver/db';
import { validateManifest } from '@photobeaver/shared/manifest';
import ffmpegPath from 'ffmpeg-static';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectorManifest } from '../../src/main/core/connectors/manifest';
import { Core } from '../../src/main/core/core';
import {
  inProcessEnricher,
  type EnricherEntry,
  type EnricherManifest,
} from '../../src/main/core/enrich/types';
import { isMergeBlocked } from '../../src/main/core/assets/merge';
import { PARIS, writeEnrichmentSet } from '../fixtures/enrichment-set';
import { openTempLibrary, silentCoreLog, type TempLibrary } from '../unit/helpers';

function enricher(raw: unknown, plugin: unknown): EnricherEntry {
  const result = validateManifest(raw);
  if (!result.ok) throw new Error(result.errors.join());
  return {
    manifest: result.manifest as unknown as EnricherManifest,
    client: inProcessEnricher(plugin as never),
  };
}

describe('enrichment pipeline headless with the default plugins', () => {
  let temp: TempLibrary;
  let root: string;
  let core: Core;
  const db = () => temp.library.db;
  const assetOf = (file: string) =>
    temp.library.sqlite
      .prepare(
        `SELECT a.* FROM assets a JOIN instances i ON i.asset_id = a.id WHERE i.external_id LIKE ? AND i.deleted_at IS NULL`,
      )
      .get(`%${file}`) as Record<string, unknown> | undefined;
  const suggestions = () =>
    db()
      .select()
      .from(schema.duplicateSuggestions)
      .all()
      .map((s) => JSON.parse(s.assetIdsJson) as string[]);

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'pb-enrich-int-'));
    await writeEnrichmentSet(root);
    temp = await openTempLibrary();
    core = new Core({
      library: temp.library,
      libraryDir: temp.dir,
      pluginDataRoot: path.join(temp.dir, 'plugin-data'),
      connectors: [
        { manifest: localManifest as ConnectorManifest, plugin: localConnector as never },
      ],
      enrichers: [
        enricher(metadataManifest, metadata),
        enricher(geocodeManifest, geocode),
        enricher(dedupManifest, dedup),
      ],
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
    await vi.waitFor(
      () =>
        expect(
          temp.library.sqlite
            .prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','leased')")
            .get(),
        ).toEqual({ n: 0 }),
      { timeout: 60_000, interval: 250 },
    );
  }, 90_000);

  afterAll(async () => {
    await core.stop();
    temp.cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  it('uses the EXIF capture time and position', () => {
    expect(assetOf('paris-1.jpg')).toMatchObject({
      captured_at: Date.UTC(2023, 4, 1, 14, 22, 33),
      captured_at_source: 'exif',
      location_source: 'exif',
    });
    expect(assetOf('paris-1.jpg')!.lat).toBeCloseTo(PARIS.lat, 3);
  });

  it('names places offline and makes them searchable', () => {
    const hits = temp.library.sqlite
      .prepare("SELECT asset_id FROM assets_fts WHERE assets_fts MATCH 'paris'")
      .all() as { asset_id: string }[];
    expect(new Set(hits.map((h) => h.asset_id))).toEqual(
      new Set([assetOf('paris-1.jpg')!.id, assetOf('paris-2.jpg')!.id]),
    );
    const tags = temp.library.sqlite
      .prepare(
        "SELECT t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ? AND t.kind = 'place'",
      )
      .all(assetOf('tokyo.jpg')!.id) as { name: string }[];
    expect(tags.map((t) => t.name)).toContain('Tokyo');
  });

  it('merges the same file copied into two folders into one asset', () => {
    const asset = assetOf('a/same.jpg')!;
    expect(assetOf('b/same.jpg')!.id).toBe(asset.id);
    const count = db()
      .select({ n: sql<number>`count(*)` })
      .from(schema.instances)
      .where(sql`asset_id = ${asset.id}`)
      .get()!.n;
    expect(count).toBe(2);
  });

  it('suggests the resized copy and leaves burst shots alone', () => {
    const big = assetOf('original.jpg')!.id as string;
    const small = assetOf('resized.jpg')!.id as string;
    expect(suggestions().some((ids) => ids.includes(big) && ids.includes(small))).toBe(true);
    const [b1, b2] = [assetOf('burst/1.jpg')!.id, assetOf('burst/2.jpg')!.id];
    expect(
      suggestions().some((ids) => ids.includes(b1 as string) && ids.includes(b2 as string)),
    ).toBe(false);
  });

  it('undoes the merge, blocks the pair, and does not merge it again on re-run', async () => {
    const merge = db().select().from(schema.assetMerges).get()!;
    core.enrichment.merges.undo(merge.id);
    expect(assetOf('a/same.jpg')!.id).not.toBe(assetOf('b/same.jpg')!.id);
    expect(isMergeBlocked(db(), merge.survivingAssetId, merge.mergedAssetId)).toBe(true);
    await core.enrichment.scheduler.queueLibrary('com.photobeaver.enricher-dedup');
    await vi.waitFor(
      () =>
        expect(
          temp.library.sqlite
            .prepare(
              "SELECT COUNT(*) n FROM jobs WHERE kind = 'enrich' AND status IN ('queued','leased')",
            )
            .get(),
        ).toEqual({ n: 0 }),
      { timeout: 30_000, interval: 250 },
    );
    expect(assetOf('a/same.jpg')!.id).not.toBe(assetOf('b/same.jpg')!.id);
  });
});
