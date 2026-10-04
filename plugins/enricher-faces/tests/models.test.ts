import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isRateLimitedError } from '@photobeaver/plugin-sdk';
import { createFakeEnrichContext } from '@photobeaver/plugin-sdk/testing';
import type { ModelSource } from '../src/models/source';
import { createFacesEnricher, type FacesEnricher } from '../src/plugin';
import type { FacesSettings } from '../src/settings';
import { asset, tempDir } from './helpers';
import { writeZip } from './zip-writer';

const DETECTOR = randomBytes(150_000);
const RECOGNIZER = randomBytes(250_000);
const ZIP = writeZip([
  { name: 'genderage.onnx', data: 'unused' },
  { name: 'det_10g.onnx', data: DETECTOR, method: 8 },
  { name: 'w600k_r50.onnx', data: RECOGNIZER },
]);
const CHUNK = 4096;
const RETRY = { initialDelayMs: 5, maxDelayMs: 20 };

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

const SOURCE: ModelSource = {
  url: 'https://github.com/test/buffalo_l.zip',
  sha256: sha256(ZIP),
  detector: { name: 'det_10g.onnx', sha256: sha256(DETECTOR) },
  recognizer: { name: 'w600k_r50.onnx', sha256: sha256(RECOGNIZER) },
};

function chunked(bytes: Buffer): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, (offset += CHUNK)));
    },
  });
}

function serve(bytes: Buffer, calls: string[] = []): typeof fetch {
  return async (input) => {
    calls.push(String(input));
    const headers = { 'content-length': String(bytes.length) };
    return new Response(chunked(bytes), { status: 200, headers });
  };
}

function hang(): typeof fetch {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) return reject(new Error('aborted'));
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
}

const plugins: FacesEnricher[] = [];

async function start(dataDir: string, fetchFn: typeof fetch, source = SOURCE) {
  const ctx = createFakeEnrichContext<FacesSettings>({ dataDir, fetch: fetchFn });
  const plugin = createFacesEnricher({ models: source, retry: RETRY, threads: 1 });
  plugins.push(plugin);
  await plugin.activate!(ctx);
  return { ctx, plugin };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

afterEach(async () => {
  await Promise.all(plugins.splice(0).map((plugin) => plugin.deactivate!()));
});

describe('model download', () => {
  it('downloads, verifies and extracts only the two models, reporting each percent once', async () => {
    const dataDir = tempDir();
    const { ctx, plugin } = await start(dataDir, serve(ZIP));
    const dir = await plugin.modelsReady();
    expect(await readFile(path.join(dir, 'det_10g.onnx'))).toEqual(DETECTOR);
    expect(await readFile(path.join(dir, 'w600k_r50.onnx'))).toEqual(RECOGNIZER);
    expect((await readdir(dir)).sort()).toEqual([
      'det_10g.onnx',
      'verified.json',
      'w600k_r50.onnx',
    ]);
    expect(await readdir(dataDir)).toEqual(['models']);
    const statuses = ctx.recorded.statuses;
    expect(statuses[0]).toBe('Downloading face models: 0%');
    expect(statuses).toContain('Downloading face models: 100%');
    expect(new Set(statuses).size).toBe(statuses.length);
    expect(statuses.slice(-2)).toEqual(['Unpacking face models', null]);
  });

  it('skips the download after a restart when the verified files are unchanged', async () => {
    const dataDir = tempDir();
    await (await start(dataDir, serve(ZIP))).plugin.modelsReady();
    const calls: string[] = [];
    const { ctx, plugin } = await start(dataDir, serve(ZIP, calls));
    await plugin.modelsReady();
    expect(calls).toEqual([]);
    expect(ctx.recorded.statuses).toEqual([null]);
  });

  it('downloads again when a model file changed on disk', async () => {
    const dataDir = tempDir();
    const dir = await (await start(dataDir, serve(ZIP))).plugin.modelsReady();
    await writeFile(path.join(dir, 'det_10g.onnx'), 'tampered');
    const calls: string[] = [];
    await (await start(dataDir, serve(ZIP, calls))).plugin.modelsReady();
    expect(calls).toEqual([SOURCE.url]);
    expect(await readFile(path.join(dir, 'det_10g.onnx'))).toEqual(DETECTOR);
  });

  it('rejects an archive with the wrong hash and keeps retrying', async () => {
    const dataDir = tempDir();
    const calls: string[] = [];
    const { ctx } = await start(dataDir, serve(ZIP, calls), { ...SOURCE, sha256: '0'.repeat(64) });
    await waitFor(() => calls.length >= 2);
    expect(ctx.recorded.statuses).toContain('Model download failed, retrying');
    expect(await readdir(path.join(dataDir, 'models'))).toEqual([]);
  });

  it('rejects a model whose hash does not match', async () => {
    const dataDir = tempDir();
    const bad = { ...SOURCE, recognizer: { ...SOURCE.recognizer, sha256: 'f'.repeat(64) } };
    const { ctx } = await start(dataDir, serve(ZIP), bad);
    await waitFor(() => ctx.recorded.statuses.includes('Model download failed, retrying'));
    expect(await readdir(path.join(dataDir, 'models'))).not.toContain('w600k_r50.onnx');
  });

  it('recovers when a failed download succeeds on retry', async () => {
    let attempts = 0;
    const flaky: typeof fetch = async (input, init) =>
      ++attempts === 1 ? new Response('busy', { status: 503 }) : serve(ZIP)(input, init);
    const { ctx, plugin } = await start(tempDir(), flaky);
    await plugin.modelsReady();
    expect(attempts).toBe(2);
    expect(ctx.recorded.statuses).toContain('Model download failed, retrying');
    expect(ctx.recorded.statuses.at(-1)).toBeNull();
  });
});

describe('enrich before the models are ready', () => {
  it('asks core to retry in 30 seconds and stops the download on deactivate', async () => {
    const dataDir = tempDir();
    const { ctx, plugin } = await start(dataDir, hang());
    const error: unknown = await plugin.enrich(ctx, asset('a')).catch((e: unknown) => e);
    expect(isRateLimitedError(error)).toBe(true);
    expect(error).toMatchObject({
      retryAfterSec: 30,
      message: 'Face models are still downloading',
    });
    const ready = plugin.modelsReady();
    await plugin.deactivate!();
    await expect(ready).rejects.toThrow('deactivated');
    expect(ctx.recorded.inputs).toEqual([]);
  });
});
