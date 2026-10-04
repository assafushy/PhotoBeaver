import { describe, expect, it } from 'vitest';
import { createFakeSourceContext } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { contextFor, seededDropbox } from './helpers';

const text = async (stream: ReadableStream<Uint8Array> | null) => new Response(stream).text();

function setup(path: string) {
  const fake = seededDropbox();
  const file = fake.addFile(path, 'original bytes');
  const ctx = createFakeSourceContext({}, contextFor(fake));
  const item = { sourceId: 'test-source', externalId: file.id };
  return { fake, file, ctx, item };
}

describe('content', () => {
  it('downloads the original by id with an ASCII Dropbox-API-Arg', async () => {
    const { fake, ctx, item } = setup('/Café/photo.jpg');
    expect(await text(await connector.getOriginal(ctx, item))).toBe('original bytes');
    const request = fake.requests.at(-1)!;
    expect(request.url).toBe('https://content.dropboxapi.com/2/files/download');
    expect(request.headers.get('dropbox-api-arg')).toBe(`{"path":"${item.externalId}"}`);
    expect(request.headers.get('authorization')).toBe(`Bearer ${fake.validToken}`);
  });

  it('fetches a small or large JPEG thumbnail', async () => {
    const { fake, ctx, item } = setup('/a/photo.png');
    expect(await text(await connector.getThumbnail!(ctx, item, 200))).toBe(
      `thumb ${item.externalId} w256h256`,
    );
    expect(await text(await connector.getThumbnail!(ctx, item, 1024))).toContain('w1024h768');
    const arg = JSON.parse(fake.requests.at(-1)!.headers.get('dropbox-api-arg')!) as unknown;
    expect(arg).toEqual({
      resource: { '.tag': 'path', path: item.externalId },
      format: 'jpeg',
      size: 'w1024h768',
      mode: 'fitone_bestfit',
    });
  });

  it('returns null when Dropbox cannot render a thumbnail', async () => {
    const { ctx, item } = setup('/a/clip.mkv');
    expect(await connector.getThumbnail!(ctx, item, 256)).toBeNull();
  });
});
