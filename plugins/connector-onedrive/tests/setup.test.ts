import { describe, expect, it } from 'vitest';
import { createFakeSourceContext } from '@photobeaver/plugin-sdk/testing';
import connector, { type OneDriveConfig } from '../src';
import { FakeGraph, graphContext } from './fake-graph';

function sourceContext(graph: FakeGraph, config: OneDriveConfig, settings: unknown) {
  return createFakeSourceContext(config, {
    ...graphContext(graph),
    secret: undefined,
    settings,
    oauthTokens: { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 123 },
  });
}

describe('setupSource', () => {
  it('signs in with Microsoft and names the source after the account and folder', async () => {
    const ctx = sourceContext(new FakeGraph(), { folder: '/Pictures/' }, { clientId: ' app-1 ' });
    const result = await connector.setupSource(ctx);
    expect(result.displayName).toBe('OneDrive (ana@example.com)/Pictures');
    expect(result.secret).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 123,
    });
    expect(ctx.recorded.oauth).toEqual([
      {
        kind: 'authorize',
        options: {
          authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          clientId: 'app-1',
          scopes: ['Files.Read', 'User.Read', 'offline_access'],
          redirectHost: 'localhost',
          extraParams: { prompt: 'select_account' },
        },
      },
    ]);
  });

  it('uses only the account when no folder is set', async () => {
    const ctx = sourceContext(new FakeGraph(), {}, { clientId: 'app-1' });
    expect((await connector.setupSource(ctx)).displayName).toBe('OneDrive (ana@example.com)');
  });

  it('refuses to start without a client ID', async () => {
    const ctx = sourceContext(new FakeGraph(), {}, {});
    await expect(connector.setupSource(ctx)).rejects.toThrow(
      "Set your Microsoft application ID in the plugin's settings first",
    );
    expect(ctx.recorded.oauth).toEqual([]);
  });
});

describe('testSource', () => {
  it('passes with valid tokens and asks for reconnecting without them', async () => {
    const graph = new FakeGraph();
    const ok = createFakeSourceContext({}, graphContext(graph));
    await expect(connector.testSource!(ok)).resolves.toBeUndefined();
    const signedOut = createFakeSourceContext({}, { ...graphContext(graph), secret: undefined });
    await expect(connector.testSource!(signedOut)).rejects.toMatchObject({
      name: 'AuthRequiredError',
    });
  });
});
