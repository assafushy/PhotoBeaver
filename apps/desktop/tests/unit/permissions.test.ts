import { describe, expect, it } from 'vitest';
import { isHostAllowed } from '../../src/plugin-host/permissions/host-allowlist';
import { FolderGrants } from '../../src/plugin-host/permissions/filesystem';
import { isPathAllowed } from '../../src/plugin-host/permissions/path-guard';
import {
  retryAfterMs,
  TokenBucket,
  createRateLimitedFetch,
} from '../../src/plugin-host/permissions/rate-limited-fetch';

describe('network allowlist', () => {
  it('matches exact hosts and subdomain wildcards', () => {
    const allow = ['api.flickr.com', '*.staticflickr.com'];
    expect(isHostAllowed('api.flickr.com', allow)).toBe(true);
    expect(isHostAllowed('API.Flickr.com.', allow)).toBe(true);
    expect(isHostAllowed('farm1.staticflickr.com', allow)).toBe(true);
    expect(isHostAllowed('staticflickr.com', allow)).toBe(false);
    expect(isHostAllowed('evilstaticflickr.com', allow)).toBe(false);
    expect(isHostAllowed('flickr.com', allow)).toBe(false);
    expect(isHostAllowed('localhost', [])).toBe(false);
  });
});

describe('filesystem guard', () => {
  it('allows granted folders and their contents only', () => {
    expect(isPathAllowed('/data/plugin/cache/x', ['/data/plugin'])).toBe(true);
    expect(isPathAllowed('/data/plugin', ['/data/plugin'])).toBe(true);
    expect(isPathAllowed('/data/plugin-other/x', ['/data/plugin'])).toBe(false);
    expect(isPathAllowed('/data/plugin/../secrets', ['/data/plugin'])).toBe(false);
  });

  it('checks string, URL and Buffer paths and ignores file descriptors', () => {
    const grants = new FolderGrants(['/allowed']);
    expect(() => grants.assert('/allowed/a.jpg')).not.toThrow();
    expect(() => grants.assert(new URL('file:///allowed/b.jpg'))).not.toThrow();
    expect(() => grants.assert(Buffer.from('/etc/passwd'))).toThrow(/not allowed/);
    expect(() => grants.assert(7)).not.toThrow();
    grants.add('/etc');
    expect(() => grants.assert('/etc/passwd')).not.toThrow();
  });
});

describe('ctx.fetch', () => {
  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs(null)).toBe(1000);
    expect(retryAfterMs(new Date(Date.now() + 3000).toUTCString())).toBeGreaterThan(1000);
  });

  it('retries 429 responses and then returns the result', async () => {
    let calls = 0;
    const base = (async () =>
      new Response(null, {
        status: ++calls < 3 ? 429 : 200,
        headers: { 'Retry-After': '0' },
      })) as typeof fetch;
    const response = await createRateLimitedFetch(base)('https://api.example.com');
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('spaces requests according to the rate limit', async () => {
    const bucket = new TokenBucket({ requests: 2, perSec: 0.1 });
    const started = Date.now();
    for (let i = 0; i < 3; i++) await bucket.take();
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });
});
