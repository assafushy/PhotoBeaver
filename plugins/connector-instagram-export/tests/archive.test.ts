import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeSourceContext, runSync } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import {
  MEDIA_DIR,
  POSTS,
  simpleExport,
  tempDir,
  writeFiles,
  writeZipParts,
  type TempDir,
} from './fixture';

let dir: TempDir;
const uris = [`${MEDIA_DIR}/1.jpg`, `${MEDIA_DIR}/2.jpg`, `media/posts/202402/3.jpg`];

beforeEach(() => {
  dir = tempDir();
});

afterEach(() => dir.cleanup());

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

describe('connector-instagram-export archives', () => {
  it('reads .zip parts in place and streams originals from them', async () => {
    writeZipParts(dir.root, simpleExport(uris));
    const config = { root: dir.root };
    const { items } = await runSync(connector, { config });
    expect(items.map((item) => item.externalId)).toEqual(uris);
    const ctx = createFakeSourceContext(config);
    const stream = await connector.getOriginal(ctx, { sourceId: 's', externalId: uris[2]! });
    expect(await readAll(stream)).toBe(`bytes of ${uris[2]}`);
  });

  it('resolves uris when the export sits under an extra folder', async () => {
    writeFiles(path.join(dir.root, 'instagram-me-2026'), simpleExport(uris));
    const { items } = await runSync(connector, { config: { root: dir.root } });
    expect(items.map((item) => item.externalId)).toEqual(uris.map((u) => `instagram-me-2026/${u}`));
  });

  it('skips a missing media file with a warning', async () => {
    writeFiles(dir.root, simpleExport(uris));
    rmSync(path.join(dir.root, uris[0]!));
    const result = await runSync(connector, { config: { root: dir.root } });
    expect(result.items).toHaveLength(2);
    const warning = result.recorded.logs.find((line) => line.level === 'warn');
    expect(warning?.data).toEqual({ uri: uris[0] });
  });

  it('skips JSON it cannot parse', async () => {
    writeFiles(dir.root, { ...simpleExport(uris), [POSTS.replace('_1', '_2')]: '{oops' });
    const result = await runSync(connector, { config: { root: dir.root } });
    expect(result.items).toHaveLength(3);
    expect(result.recorded.logs.some((line) => line.level === 'warn')).toBe(true);
  });

  it('throws without deleting anything when the root is missing', async () => {
    const config = { root: path.join(dir.root, 'gone') };
    await expect(runSync(connector, { config })).rejects.toThrow('not available');
  });

  it('has no thumbnails', async () => {
    const ctx = createFakeSourceContext({ root: dir.root });
    expect(await connector.getThumbnail?.(ctx, { sourceId: 's', externalId: uris[0]! }, 256)).toBe(
      null,
    );
  });
});
