import { describe, expect, it } from 'vitest';
import { isAuthRequiredError, isRateLimitedError } from '../src/errors';
import { apiFetch, fetchJson, HttpError, tokenStore } from '../src/http';
import { createFakeSourceContext } from '../src/testing';

const TOKEN_OPTIONS = { tokenUrl: 'https://auth.example.com/token', clientId: 'c' };

function api(handler: (req: Request) => Response): { fetch: typeof fetch; seen: Request[] } {
  const seen: Request[] = [];
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const req = new Request(input, init);
    seen.push(req);
    return handler(req);
  }) as typeof fetch;
  return { fetch: fetchFn, seen };
}

const authorized = (token: string) => (req: Request) =>
  req.headers.get('authorization') === `Bearer ${token}`
    ? Response.json({ ok: true })
    : new Response('expired', { status: 401 });

describe('apiFetch and fetchJson', () => {
  it('sends JSON bodies and parses JSON responses', async () => {
    const { fetch, seen } = api(() => Response.json({ items: [1] }));
    expect(await fetchJson(fetch, 'https://x.test/a', { method: 'POST', json: { q: 1 } })).toEqual({
      items: [1],
    });
    expect(seen[0]!.headers.get('content-type')).toBe('application/json');
    expect(await seen[0]!.text()).toBe('{"q":1}');
  });

  it('turns 429 into RateLimitedError with Retry-After and other failures into HttpError', async () => {
    const limited = api(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }),
    );
    const error = await apiFetch(limited.fetch, 'https://x.test').catch((e: unknown) => e);
    expect(isRateLimitedError(error) && error.retryAfterSec).toBe(7);
    const broken = api(() => new Response('nope', { status: 500 }));
    await expect(apiFetch(broken.fetch, 'https://x.test')).rejects.toBeInstanceOf(HttpError);
  });

  it('refreshes once on 401 and saves the rotated tokens', async () => {
    const ctx = createFakeSourceContext(
      {},
      {
        secret: { accessToken: 'old', refreshToken: 'r1' },
        oauthTokens: { accessToken: 'new', refreshToken: 'r2' },
      },
    );
    const { fetch } = api(authorized('new'));
    const auth = tokenStore(ctx, TOKEN_OPTIONS);
    expect(await fetchJson(fetch, 'https://x.test', { auth })).toEqual({ ok: true });
    expect(ctx.recorded.secret).toMatchObject({ accessToken: 'new', refreshToken: 'r2' });
    expect(ctx.recorded.oauth).toHaveLength(1);
  });

  it('throws AuthRequiredError when the refreshed token is still rejected', async () => {
    const ctx = createFakeSourceContext({}, { secret: { accessToken: 'old', refreshToken: 'r1' } });
    const { fetch } = api(() => new Response('no', { status: 401 }));
    const error = await apiFetch(fetch, 'https://x.test', {
      auth: tokenStore(ctx, TOKEN_OPTIONS),
    }).catch((e: unknown) => e);
    expect(isAuthRequiredError(error)).toBe(true);
  });
});

describe('tokenStore', () => {
  it('refreshes before expiry and keeps the refresh token when none is returned', async () => {
    const ctx = createFakeSourceContext(
      {},
      {
        secret: { accessToken: 'old', refreshToken: 'keep', expiresAt: Date.now() + 1000 },
        oauthTokens: { accessToken: 'fresh' },
      },
    );
    expect(await tokenStore(ctx, TOKEN_OPTIONS).accessToken()).toBe('fresh');
    expect(ctx.recorded.secret).toMatchObject({ accessToken: 'fresh', refreshToken: 'keep' });
  });

  it('requires reconnecting when there is no secret or the refresh is rejected', async () => {
    const empty = createFakeSourceContext({});
    expect(
      isAuthRequiredError(
        await tokenStore(empty, TOKEN_OPTIONS)
          .accessToken()
          .catch((e: unknown) => e),
      ),
    ).toBe(true);
    const rejected = createFakeSourceContext(
      {},
      {
        secret: { accessToken: 'a', refreshToken: 'r', expiresAt: 0 },
        oauth: { refresh: async () => Promise.reject(new Error('invalid_grant')) },
      },
    );
    expect(
      isAuthRequiredError(
        await tokenStore(rejected, TOKEN_OPTIONS)
          .accessToken()
          .catch((e: unknown) => e),
      ),
    ).toBe(true);
  });

  it('rethrows network failures so the sync retries instead of asking to reconnect', async () => {
    const ctx = createFakeSourceContext(
      {},
      {
        secret: { accessToken: 'a', refreshToken: 'r', expiresAt: 0 },
        oauth: { refresh: async () => Promise.reject(new TypeError('fetch failed')) },
      },
    );
    await expect(tokenStore(ctx, TOKEN_OPTIONS).accessToken()).rejects.toBeInstanceOf(TypeError);
  });
});
