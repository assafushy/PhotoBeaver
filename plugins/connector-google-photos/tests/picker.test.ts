import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createFakeSourceContext,
  runSync,
  type FakeContextOptions,
} from '@photobeaver/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';
import connector, { PAGE_SIZE, type GooglePhotosConfig } from '../src';
import { MISSING_CLIENT } from '../src/config';
import { parseDurationMs } from '../src/picker/duration';
import { PICK_PROMPT } from '../src/picker/sync';
import { safeName } from '../src/picker/previews';
import { FakePicker, pickedItem } from './fake-picker';
import { readText } from './helpers';

type Options = Omit<FakeContextOptions, 'known'>;

const config: GooglePhotosConfig = { mode: 'picker' };
const settings = { clientId: 'client-id', clientSecret: 'client-secret' };

function setup(count = PAGE_SIZE + 20) {
  const items = Array.from({ length: count }, (_, i) => pickedItem(i, i === 1 ? 'VIDEO' : 'PHOTO'));
  const fake = new FakePicker(items);
  const context: Options = {
    fetch: fake.fetch,
    settings,
    secret: { accessToken: 'expired-token', refreshToken: 'refresh-token' },
    oauth: { refresh: fake.refresh },
    dataDir: mkdtempSync(path.join(tmpdir(), 'pb-gphotos-data-')),
  };
  return { fake, context };
}

function sourceCtx(context: Options) {
  return createFakeSourceContext(config, context);
}

describe('Picker sync', () => {
  it('opens the Picker, reads the picked items in pages and deletes the session', async () => {
    const { fake, context } = setup();
    const result = await runSync(connector, { config, context });
    expect(result.recorded.opened).toEqual(['https://photos.google.com/picker/session-1']);
    expect(result.recorded.notifications).toContainEqual({ msg: PICK_PROMPT, level: undefined });
    expect(result.batches.map((batch) => batch.upserts?.length)).toEqual([PAGE_SIZE, 20]);
    expect(result.batches.map((batch) => batch.cursor)).toEqual([
      `session:session-1:page:${PAGE_SIZE}`,
      'done',
    ]);
    expect(result.batches.some((batch) => batch.isFullScan || batch.deletes)).toBe(false);
    expect(fake.deleted).toEqual(['session-1']);
  });

  it('maps picked items to media items', async () => {
    const { context } = setup(2);
    const [photo, video] = (await runSync(connector, { config, context })).items;
    expect(photo).toEqual({
      externalId: 'item-0',
      kind: 'image',
      mime: 'image/jpeg',
      filename: 'IMG_0.jpg',
      capturedAt: '2024-01-01T00:00:00.000Z',
      width: 4000,
      height: 3000,
      metadata: { preview: true },
    });
    expect(video).toMatchObject({ kind: 'video', mime: 'video/mp4', filename: 'VID_1.mp4' });
  });

  it('saves 1024 px previews and serves them as thumbnail and original', async () => {
    const { context } = setup(2);
    await runSync(connector, { config, context });
    const ctx = sourceCtx(context);
    const photo = { sourceId: ctx.sourceId, externalId: 'item-0' };
    const video = { sourceId: ctx.sourceId, externalId: 'item-1' };
    expect(await readText(await connector.getThumbnail!(ctx, photo, 256))).toBe(
      'preview:item-0:w1024-h1024',
    );
    expect(await readText(await connector.getOriginal(ctx, video))).toBe(
      'preview:item-1:w1024-h1024-no',
    );
    const missing = { sourceId: ctx.sourceId, externalId: 'item-9' };
    expect(await connector.getThumbnail!(ctx, missing, 256)).toBeNull();
    await expect(connector.getOriginal(ctx, missing)).rejects.toThrow(/No saved preview/);
  });

  it('refreshes an expired token once with the client secret and saves it', async () => {
    const { fake, context } = setup(1);
    const result = await runSync(connector, { config, context });
    expect(fake.tokenRequests).toBe(1);
    expect(result.recorded.oauth).toEqual([
      {
        kind: 'refresh',
        options: expect.objectContaining({ clientSecret: 'client-secret' }),
      },
    ]);
    expect(result.recorded.secret).toMatchObject({
      accessToken: 'fresh-token',
      refreshToken: 'refresh-token',
    });
  });

  it('asks to reconnect when the refresh is rejected', async () => {
    const { context } = setup(1);
    const refresh = async () => {
      throw new Error('invalid_grant');
    };
    const run = runSync(connector, { config, context: { ...context, oauth: { refresh } } });
    await expect(run).rejects.toMatchObject({ name: 'AuthRequiredError' });
  });

  it('keeps an item whose preview could not be downloaded', async () => {
    const { fake, context } = setup(2);
    fake.failingPreviews.add('item-0');
    const result = await runSync(connector, { config, context });
    expect(result.items.map((item) => item.metadata)).toEqual([
      { preview: false },
      { preview: true },
    ]);
    expect(result.recorded.logs.some((line) => line.level === 'warn')).toBe(true);
  });

  it('ends with an empty batch when the user does not finish picking', async () => {
    const { fake, context } = setup(3);
    fake.neverFinish = true;
    fake.timeoutIn = '0.05s';
    const result = await runSync(connector, { config, context });
    expect(result.batches).toEqual([{ upserts: [], cursor: 'done' }]);
    expect(fake.deleted).toEqual(['session-1']);
  });

  it('stops waiting when the sync is cancelled', async () => {
    const { fake, context } = setup(3);
    fake.neverFinish = true;
    const signal = AbortSignal.timeout(50);
    await expect(runSync(connector, { config, context: { ...context, signal } })).rejects.toThrow();
    expect(fake.deleted).toEqual(['session-1']);
  });
});

describe('Picker resume', () => {
  it('reads the rest of an interrupted session without opening the Picker', async () => {
    const { fake, context } = setup();
    fake.addFinishedSession('earlier');
    const cursor = `session:earlier:page:${PAGE_SIZE}`;
    const result = await runSync(connector, { config, context, cursor });
    expect(result.items).toHaveLength(20);
    expect(result.recorded.opened).toEqual([]);
    expect(fake.deleted).toEqual(['earlier']);
  });

  it('yields nothing for a session that is gone', async () => {
    const { fake, context } = setup();
    const result = await runSync(connector, { config, context, cursor: 'session:gone:page:5' });
    expect(result.batches).toEqual([{ upserts: [], cursor: 'done' }]);
    expect(result.recorded.opened).toEqual([]);
    expect(fake.sessions.size).toBe(0);
  });

  it('starts a new pick after a finished sync', async () => {
    const { context } = setup(1);
    const result = await runSync(connector, { config, context, cursor: 'done' });
    expect(result.recorded.opened).toHaveLength(1);
  });
});

describe('Picker setup', () => {
  it('signs in with the Picker scope, the client secret and a loopback redirect', async () => {
    const { context } = setup();
    const ctx = sourceCtx({ ...context, secret: undefined });
    const result = await connector.setupSource(ctx);
    expect(result.displayName).toBe('Google Photos (picked items)');
    expect(result.secret).toMatchObject({ accessToken: 'fake-access-token' });
    expect(ctx.recorded.oauth[0]).toEqual({
      kind: 'authorize',
      options: {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        scopes: ['https://www.googleapis.com/auth/photospicker.mediaitems.readonly'],
        extraParams: { access_type: 'offline', prompt: 'consent' },
        redirectHost: '127.0.0.1',
      },
    });
  });

  it('defaults to the Picker and needs the client ID and secret', async () => {
    const { context } = setup();
    const noSecret = sourceCtx({ ...context, settings: { clientId: 'client-id' } });
    const ctx = createFakeSourceContext({}, { ...context, settings: {} });
    await expect(connector.setupSource(ctx)).rejects.toThrow(MISSING_CLIENT);
    await expect(connector.setupSource(noSecret)).rejects.toThrow(MISSING_CLIENT);
    expect(ctx.recorded.oauth).toEqual([]);
    const run = runSync(connector, { config, context: { ...context, settings: undefined } });
    await expect(run).rejects.toThrow(MISSING_CLIENT);
  });

  it('tests the saved sign-in', async () => {
    const { context } = setup();
    await expect(connector.testSource!(sourceCtx(context))).resolves.toBeUndefined();
    const ctx = sourceCtx({ ...context, secret: undefined });
    await expect(connector.testSource!(ctx)).rejects.toMatchObject({ name: 'AuthRequiredError' });
  });
});

describe('Picker helpers', () => {
  it('parses API durations', () => {
    expect(parseDurationMs('5s', 1)).toBe(5000);
    expect(parseDurationMs('0.01s', 1)).toBe(10);
    expect(parseDurationMs('1799.5s', 1)).toBe(1_799_500);
    expect(parseDurationMs(undefined, 7)).toBe(7);
    expect(parseDurationMs('5m', 7)).toBe(7);
  });

  it('makes distinct ids into distinct safe file names', () => {
    expect(safeName('AbC_-1')).toBe('AbC_-1');
    expect(safeName('a/b')).not.toBe(safeName('a_b'));
    expect(safeName('../x')).not.toContain('/');
  });
});
