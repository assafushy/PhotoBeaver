import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { schema } from '@photobeaver/db';
import type { ConnectorPlugin, SourceContext } from '@photobeaver/plugin-sdk';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectorManifest } from '../../src/main/core/connectors/manifest';
import { Core } from '../../src/main/core/core';
import { sourceDataDir } from '../../src/main/core/sources/source-service';
import { fakeCipher, openTempLibrary, silentCoreLog, type TempLibrary } from './helpers';

const ID = 'com.example.cloud';
const MANIFEST: ConnectorManifest = {
  id: ID,
  name: 'Cloud',
  version: '1.0.0',
  type: 'connector',
  apiVersion: '1',
  permissions: { oauth: true, network: ['auth.example.com', 'photos.example.com'] },
  connector: { syncModes: ['poll'], defaultIntervalSec: 3600 },
};

interface Behaviour {
  signIn(ctx: SourceContext<unknown>): Promise<Record<string, unknown>>;
}

function cloudConnector(behaviour: Behaviour): ConnectorPlugin<unknown> {
  return {
    setupSource: async (ctx) => ({
      displayName: 'Cloud account',
      secret: await behaviour.signIn(ctx),
    }),
    sync: async function* () {
      yield { upserts: [], cursor: 'done', isFullScan: true };
    },
    getOriginal: async () => new Blob(['x']).stream() as ReadableStream<Uint8Array>,
  };
}

function never(ctx: SourceContext<unknown>): Promise<never> {
  return new Promise((_, reject) =>
    ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))),
  );
}

describe('source setup with secrets', () => {
  let temp: TempLibrary;
  let core: Core;
  let opened: string[];
  const behaviour: Behaviour = { signIn: async () => ({ accessToken: 'first' }) };
  const secretRows = () => temp.library.db.select().from(schema.secrets).all();
  const sourceRow = (id: string) =>
    temp.library.db.select().from(schema.sources).where(eq(schema.sources.id, id)).get()!;

  beforeEach(async () => {
    temp = await openTempLibrary();
    opened = [];
    behaviour.signIn = async () => ({ accessToken: 'first' });
    core = new Core({
      library: temp.library,
      libraryDir: temp.dir,
      pluginDataRoot: path.join(temp.dir, 'plugin-data'),
      connectors: [{ manifest: MANIFEST, plugin: cloudConnector(behaviour) }],
      events: { emit: () => undefined },
      logger: silentCoreLog,
      ffmpegPath: 'ffmpeg',
      pickDirectory: async () => null,
      secretCipher: fakeCipher,
      openExternal: async (url) => void opened.push(url),
    });
    core.registry.registerBuiltins(0);
  });

  afterEach(async () => {
    await core.stop();
    temp.cleanup();
  });

  it('stores the setup secret encrypted and exposes it to the connector', async () => {
    const source = await core.sources.add({ pluginId: ID, config: {} }, 'admin');
    expect(sourceRow(source.id).secretRef).toBe(`source:${source.id}`);
    expect(core.secrets.get(`source:${source.id}`)).toEqual({ accessToken: 'first' });
    const ctx = core.registry.sourceContext(
      { id: source.id, pluginId: ID, config: {} },
      new AbortController().signal,
    );
    expect(await ctx.secret.get()).toEqual({ accessToken: 'first' });
  });

  it('cancels a waiting setup without leaving a source or secret behind', async () => {
    behaviour.signIn = async (ctx) => (await ctx.secret.set({ partial: true }), never(ctx));
    const adding = core.sources.add({ pluginId: ID, config: {}, setupId: 'setup-1' }, 'admin');
    await new Promise((resolve) => setTimeout(resolve, 20));
    core.sources.cancelSetup('setup-1');
    await expect(adding).rejects.toThrow('Setup was cancelled');
    expect(temp.library.db.select().from(schema.sources).all()).toHaveLength(0);
    expect(secretRows()).toHaveLength(0);
  });

  it('reconnects a source that needs signing in again', async () => {
    const source = await core.sources.add({ pluginId: ID, config: {} }, 'admin');
    temp.library.db
      .update(schema.sources)
      .set({ syncState: 'auth_required', lastError: 'expired' })
      .where(eq(schema.sources.id, source.id))
      .run();
    behaviour.signIn = async () => ({ accessToken: 'second' });
    const updated = await core.sources.reconnect(source.id, undefined, 'admin');
    expect(updated.syncState).not.toBe('auth_required');
    expect(core.secrets.get(`source:${source.id}`)).toEqual({ accessToken: 'second' });
  });

  it('keeps the old secret when reconnecting fails, and deletes it and source data with the source', async () => {
    const source = await core.sources.add({ pluginId: ID, config: {} }, 'admin');
    behaviour.signIn = async () => Promise.reject(new Error('denied'));
    await expect(core.sources.reconnect(source.id, undefined, 'admin')).rejects.toThrow('denied');
    expect(core.secrets.get(`source:${source.id}`)).toEqual({ accessToken: 'first' });
    const dataDir = sourceDataDir(path.join(temp.dir, 'plugin-data'), ID, source.id);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, 'preview.jpg'), 'x');
    await core.sources.remove(source.id, 'admin');
    expect(secretRows()).toHaveLength(0);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('opens only https links on the plugin hosts', async () => {
    const ctx = core.registry.sourceContext(
      { id: 's', pluginId: ID, config: {} },
      new AbortController().signal,
    );
    await ctx.ui.openExternal('https://photos.example.com/pick?x=1');
    await expect(ctx.ui.openExternal('https://evil.example.org/')).rejects.toThrow(/not allowed/);
    await expect(ctx.ui.openExternal('http://photos.example.com/')).rejects.toThrow(/not allowed/);
    expect(opened).toEqual(['https://photos.example.com/pick?x=1']);
  });
});
