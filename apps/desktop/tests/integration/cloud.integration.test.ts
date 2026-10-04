import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import dropbox from '@photobeaver/connector-dropbox';
import dropboxManifest from '@photobeaver/connector-dropbox/manifest' with { type: 'json' };
import localConnector from '@photobeaver/connector-local';
import localManifest from '@photobeaver/connector-local/manifest' with { type: 'json' };
import dedup from '@photobeaver/enricher-dedup';
import dedupManifest from '@photobeaver/enricher-dedup/manifest' with { type: 'json' };
import metadata from '@photobeaver/enricher-metadata';
import metadataManifest from '@photobeaver/enricher-metadata/manifest' with { type: 'json' };
import { schema } from '@photobeaver/db';
import { settingsSchemaOf, validateManifest } from '@photobeaver/shared/manifest';
import { eq } from 'drizzle-orm';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectorManifest } from '../../src/main/core/connectors/manifest';
import { Core } from '../../src/main/core/core';
import {
  inProcessEnricher,
  type EnricherEntry,
  type EnricherManifest,
} from '../../src/main/core/enrich/types';
import { writeGeoPhoto } from '../fixtures/generate';
import { fakeCipher, openTempLibrary, silentCoreLog, type TempLibrary } from '../unit/helpers';
import { FakeDropboxApi } from './fake-dropbox-api';

const LOCAL = 'com.photobeaver.connector-local';
const DROPBOX = 'com.photobeaver.connector-dropbox';

function enricher(raw: unknown, plugin: unknown): EnricherEntry {
  const result = validateManifest(raw);
  if (!result.ok) throw new Error(result.errors.join());
  return {
    manifest: result.manifest as unknown as EnricherManifest,
    client: inProcessEnricher(plugin as never),
  };
}

function browserThatApproves(): (url: string) => Promise<void> {
  return async (raw) => {
    const url = new URL(raw);
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('code', 'code-1');
    redirect.searchParams.set('state', url.searchParams.get('state')!);
    setTimeout(() => void fetch(redirect).catch(() => undefined), 10);
  };
}

describe('cloud connectors in the headless core', () => {
  let temp: TempLibrary;
  let root: string;
  let core: Core;
  const api = new FakeDropboxApi();
  const sql = () => temp.library.sqlite;
  const idle = () =>
    vi.waitFor(
      () =>
        expect(
          sql()
            .prepare(
              "SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','leased') AND kind != 'plugin_task'",
            )
            .get(),
        ).toEqual({ n: 0 }),
      { timeout: 60_000, interval: 250 },
    );
  const sourceOf = (pluginId: string) =>
    temp.library.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.pluginId, pluginId))
      .get()!;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'pb-cloud-int-'));
    const file = await writeGeoPhoto(root, {
      file: 'beach.jpg',
      seed: 21,
      date: '2024:07:01 10:00:00',
    });
    api.add('/Photos/beach.jpg', readFileSync(file));
    temp = await openTempLibrary();
    core = new Core({
      library: temp.library,
      libraryDir: temp.dir,
      pluginDataRoot: path.join(temp.dir, 'plugin-data'),
      connectors: [
        { manifest: localManifest as ConnectorManifest, plugin: localConnector as never },
        { manifest: dropboxManifest as unknown as ConnectorManifest, plugin: dropbox as never },
      ],
      enrichers: [enricher(metadataManifest, metadata), enricher(dedupManifest, dedup)],
      events: { emit: () => undefined },
      logger: silentCoreLog,
      ffmpegPath: ffmpegPath as unknown as string,
      pickDirectory: async () => null,
      secretCipher: fakeCipher,
      openExternal: browserThatApproves(),
      fetch: api.fetch,
    });
    core.enrichment.settings.set(DROPBOX, settingsSchemaOf(dropboxManifest as never) ?? {}, {
      clientId: 'app-key',
    });
    core.start();
    await core.sources.add({ pluginId: LOCAL, config: { root } }, 'admin');
    await core.sources.add({ pluginId: DROPBOX, config: {} }, 'admin');
    await idle();
  }, 90_000);

  afterAll(async () => {
    await core.stop();
    temp.cleanup();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('signs in through the broker and keeps the tokens encrypted', () => {
    const source = sourceOf(DROPBOX);
    expect(source.displayName).toContain('me@example.com');
    expect(core.secrets.get(source.secretRef!)).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh',
    });
  });

  it('merges the same photo on disk and in Dropbox into one asset with two instances', () => {
    const rows = sql()
      .prepare('SELECT asset_id, source_id FROM instances WHERE deleted_at IS NULL')
      .all() as { asset_id: string; source_id: string }[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.source_id)).size).toBe(2);
    expect(new Set(rows.map((r) => r.asset_id)).size).toBe(1);
  });

  it('refreshes an expired token during sync', async () => {
    api.expireAccessToken();
    core.sources.syncNow(sourceOf(DROPBOX).id);
    await idle();
    expect(sourceOf(DROPBOX).syncState).toBe('idle');
    expect(core.secrets.get(sourceOf(DROPBOX).secretRef!)).toMatchObject({
      accessToken: 'access-2',
    });
  });

  it('asks to reconnect when the sign-in is revoked, and Reconnect restores sync', async () => {
    api.expireAccessToken();
    api.revoked = true;
    core.sources.syncNow(sourceOf(DROPBOX).id);
    await vi.waitFor(() => expect(sourceOf(DROPBOX).syncState).toBe('auth_required'), {
      timeout: 20_000,
    });
    await core.sources.reconnect(sourceOf(DROPBOX).id, undefined, 'admin');
    await idle();
    expect(sourceOf(DROPBOX).syncState).toBe('idle');
  });
});
