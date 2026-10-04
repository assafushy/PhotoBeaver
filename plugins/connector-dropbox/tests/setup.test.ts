import { describe, expect, it } from 'vitest';
import { createFakeSourceContext } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { contextFor, seededDropbox } from './helpers';

describe('setupSource', () => {
  it('signs in with the Dropbox OAuth options and names the source', async () => {
    const fake = seededDropbox();
    const ctx = createFakeSourceContext(
      { folder: 'Photos/' },
      contextFor(fake, { secret: undefined, oauthTokens: fake.tokens() }),
    );
    const result = await connector.setupSource(ctx);
    expect(result).toEqual({
      displayName: 'Dropbox (beaver@example.com) /Photos',
      secret: fake.tokens(),
    });
    expect(ctx.recorded.oauth).toEqual([
      {
        kind: 'authorize',
        options: {
          authUrl: 'https://www.dropbox.com/oauth2/authorize',
          tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
          clientId: 'k',
          scopes: ['files.metadata.read', 'files.content.read', 'account_info.read'],
          extraParams: { token_access_type: 'offline' },
          redirectHost: '127.0.0.1',
          redirectPorts: [53682, 53683, 53684],
        },
      },
    ]);
  });

  it('calls get_current_account without a body or content type', async () => {
    const fake = seededDropbox();
    const ctx = createFakeSourceContext({}, contextFor(fake, { oauthTokens: fake.tokens() }));
    expect((await connector.setupSource(ctx)).displayName).toBe('Dropbox (beaver@example.com)');
    const request = fake.requests.at(-1)!;
    expect(request.url).toBe('https://api.dropboxapi.com/2/users/get_current_account');
    expect(request.method).toBe('POST');
    expect(request.body).toBeNull();
    expect(request.headers.has('content-type')).toBe(false);
  });

  it('asks for the app key before signing in', async () => {
    const fake = seededDropbox();
    const ctx = createFakeSourceContext({}, contextFor(fake, { settings: { clientId: ' ' } }));
    await expect(connector.setupSource(ctx)).rejects.toThrow(
      "Set your Dropbox app key in the plugin's settings first",
    );
    expect(ctx.recorded.oauth).toEqual([]);
  });

  it('testSource makes one authorized call', async () => {
    const fake = seededDropbox();
    await connector.testSource!(createFakeSourceContext({}, contextFor(fake)));
    expect(fake.requests.map((r) => r.url)).toEqual([
      'https://api.dropboxapi.com/2/users/get_current_account',
    ]);
  });
});
