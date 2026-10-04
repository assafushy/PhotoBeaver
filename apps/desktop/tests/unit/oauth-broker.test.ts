import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { OAuthBroker, type OAuthPluginInfo } from '../../src/main/core/oauth/oauth-broker';

const PLUGIN: OAuthPluginInfo = {
  id: 'com.example.cloud',
  permissions: { oauth: true, network: ['auth.example.com'] },
};
const OPTIONS = {
  authUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  clientId: 'client-1',
  scopes: ['read', 'offline'],
};

interface TokenRequest {
  form: URLSearchParams;
}

function fakeTokenEndpoint(requests: TokenRequest[], challenges: string[]): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body));
    requests.push({ form });
    const verifier = form.get('code_verifier');
    const valid =
      verifier === null ||
      challenges.includes(createHash('sha256').update(verifier).digest('base64url'));
    if (!valid) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({
      access_token: `at-${requests.length}`,
      refresh_token: 'rt',
      expires_in: 3600,
    });
  }) as typeof fetch;
}

function browserThatSignsIn(challenges: string[], tamper: (url: URL) => void = () => undefined) {
  return async (raw: string) => {
    const url = new URL(raw);
    challenges.push(url.searchParams.get('code_challenge')!);
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('code', 'the-code');
    redirect.searchParams.set('state', url.searchParams.get('state')!);
    tamper(redirect);
    setTimeout(() => void fetch(redirect).catch(() => undefined), 10);
  };
}

function setup(openExternal: (url: string) => Promise<void>, timeoutMs = 5000) {
  const requests: TokenRequest[] = [];
  const challenges: string[] = [];
  const broker = new OAuthBroker({
    openExternal,
    fetch: fakeTokenEndpoint(requests, challenges),
    timeoutMs,
    now: () => 1000,
  });
  return { broker, requests, challenges };
}

describe('OAuthBroker', () => {
  const blockers: Server[] = [];
  afterEach(() => blockers.splice(0).forEach((server) => server.close()));

  it('runs the PKCE code flow through a loopback redirect', async () => {
    const challenges: string[] = [];
    const requests: TokenRequest[] = [];
    const broker = new OAuthBroker({
      openExternal: browserThatSignsIn(challenges),
      fetch: fakeTokenEndpoint(requests, challenges),
      now: () => 1000,
    });
    const tokens = await broker.authorize(PLUGIN, OPTIONS, new AbortController().signal);
    expect(tokens).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt',
      expiresAt: 1000 + 3_600_000,
      scope: undefined,
      tokenType: undefined,
    });
    const form = requests[0]!.form;
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(form.get('client_secret')).toBeNull();
  });

  it('rejects a callback with the wrong state', async () => {
    const challenges: string[] = [];
    const { broker } = setup(
      browserThatSignsIn(challenges, (url) => url.searchParams.set('state', 'forged')),
    );
    await expect(broker.authorize(PLUGIN, OPTIONS, new AbortController().signal)).rejects.toThrow(
      /did not match/,
    );
  });

  it('gives up after the timeout and when cancelled', async () => {
    const { broker } = setup(async () => undefined, 50);
    await expect(broker.authorize(PLUGIN, OPTIONS, new AbortController().signal)).rejects.toThrow(
      /timed out/,
    );
    const controller = new AbortController();
    const pending = setup(async () => undefined).broker.authorize(
      PLUGIN,
      OPTIONS,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it('falls back to the next fixed port when one is busy', async () => {
    const busy = createServer().listen(0, '127.0.0.1');
    blockers.push(busy);
    await new Promise((resolve) => busy.once('listening', resolve));
    const busyPort = (busy.address() as { port: number }).port;
    const free = createServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => free.once('listening', resolve));
    const freePort = (free.address() as { port: number }).port;
    await new Promise((resolve) => free.close(resolve));
    const challenges: string[] = [];
    const requests: TokenRequest[] = [];
    const broker = new OAuthBroker({
      openExternal: browserThatSignsIn(challenges),
      fetch: fakeTokenEndpoint(requests, challenges),
    });
    await broker.authorize(
      PLUGIN,
      { ...OPTIONS, redirectPorts: [busyPort, freePort] },
      new AbortController().signal,
    );
    expect(requests[0]!.form.get('redirect_uri')).toBe(`http://127.0.0.1:${freePort}/callback`);
  });

  it('refuses plugins without OAuth permission and undeclared token hosts', async () => {
    const { broker } = setup(async () => undefined);
    const signal = new AbortController().signal;
    await expect(
      broker.authorize(
        { ...PLUGIN, permissions: { oauth: false, network: ['auth.example.com'] } },
        OPTIONS,
        signal,
      ),
    ).rejects.toThrow(/OAuth permission/);
    await expect(
      broker.authorize(PLUGIN, { ...OPTIONS, tokenUrl: 'https://evil.example.org/token' }, signal),
    ).rejects.toThrow(/may not send tokens/);
    await expect(
      broker.authorize(PLUGIN, { ...OPTIONS, authUrl: 'http://auth.example.com/a' }, signal),
    ).rejects.toThrow(/https/);
  });

  it('refreshes tokens and sends the client secret when given', async () => {
    const { broker, requests } = setup(async () => undefined);
    const tokens = await broker.refresh(PLUGIN, {
      tokenUrl: OPTIONS.tokenUrl,
      clientId: 'c',
      refreshToken: 'rt',
      clientSecret: 's',
    });
    expect(tokens.accessToken).toBe('at-1');
    expect(requests[0]!.form.get('grant_type')).toBe('refresh_token');
    expect(requests[0]!.form.get('client_secret')).toBe('s');
  });
});
