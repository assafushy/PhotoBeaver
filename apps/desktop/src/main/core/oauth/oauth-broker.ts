import type {
  OAuthAuthorizeOptions,
  OAuthRefreshOptions,
  OAuthTokens,
} from '@photobeaver/plugin-sdk';
import { isHostAllowed } from '@photobeaver/shared/host-allowlist';
import { CALLBACK_PATH, startLoopback, waitForCode } from './loopback-server';
import { createPkce, createState, type Pkce } from './pkce';
import { requestTokens } from './token-client';

export const AUTHORIZE_TIMEOUT_MS = 5 * 60_000;

export interface OAuthPluginInfo {
  id: string;
  permissions: { oauth: boolean; network: readonly string[] };
}

export interface OAuthBrokerDeps {
  openExternal(url: string): Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function assertHttps(url: string, label: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error(`The ${label} must use https`);
  return parsed;
}

/**
 * Checks that the plugin may use OAuth and that the token endpoint is on a host
 * it declared, so tokens only go where the install dialog said they would.
 *
 * @param plugin - Plugin id and permissions.
 * @param tokenUrl - Token endpoint.
 * @param authUrl - Authorization endpoint, when authorizing.
 */
export function assertOAuthAllowed(
  plugin: OAuthPluginInfo,
  tokenUrl: string,
  authUrl?: string,
): void {
  if (!plugin.permissions.oauth) throw new Error(`${plugin.id} does not have OAuth permission`);
  if (authUrl) assertHttps(authUrl, 'authorization URL');
  const host = assertHttps(tokenUrl, 'token URL').hostname;
  if (!isHostAllowed(host, plugin.permissions.network))
    throw new Error(`${plugin.id} may not send tokens to ${host}`);
}

function authorizeUrl(
  opts: OAuthAuthorizeOptions,
  redirectUri: string,
  pkce: Pkce,
  state: string,
): string {
  const url = new URL(opts.authUrl);
  const params = {
    ...opts.extraParams,
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    scope: opts.scopes.join(' '),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const withSecret = (form: Record<string, string>, secret?: string) =>
  secret ? { ...form, client_secret: secret } : form;

/**
 * The OAuth broker (SPEC 3.1, 6.4): runs the authorization code flow with PKCE
 * through the system browser and a loopback redirect, and refreshes tokens.
 * Plugins never see the authorization code or run a server themselves.
 */
export class OAuthBroker {
  constructor(private readonly deps: OAuthBrokerDeps) {}

  /**
   * Opens the provider's sign-in page and waits for the redirect.
   *
   * @param plugin - Calling plugin.
   * @param opts - Provider endpoints, client and scopes.
   * @param signal - Cancels the wait (closing the dialog, removing the source).
   * @returns The tokens.
   */
  async authorize(
    plugin: OAuthPluginInfo,
    opts: OAuthAuthorizeOptions,
    signal: AbortSignal,
  ): Promise<OAuthTokens> {
    assertOAuthAllowed(plugin, opts.tokenUrl, opts.authUrl);
    const host = opts.redirectHost ?? '127.0.0.1';
    const { server, port } = await startLoopback(host, opts.redirectPorts ?? []);
    try {
      const redirectUri = `http://${host}:${port}${CALLBACK_PATH}`;
      const code = await this.signIn(server, opts, redirectUri, signal);
      return await this.exchange(opts, redirectUri, code);
    } finally {
      server.close();
    }
  }

  /**
   * Exchanges a refresh token for new tokens.
   *
   * @param plugin - Calling plugin.
   * @param opts - Token endpoint, client and refresh token.
   * @returns The new tokens. Providers that rotate refresh tokens return a new one.
   */
  refresh(plugin: OAuthPluginInfo, opts: OAuthRefreshOptions): Promise<OAuthTokens> {
    assertOAuthAllowed(plugin, opts.tokenUrl);
    const form = {
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      ...(opts.scopes?.length ? { scope: opts.scopes.join(' ') } : {}),
    };
    return this.post(opts.tokenUrl, withSecret(form, opts.clientSecret));
  }

  private async signIn(
    server: Parameters<typeof waitForCode>[0],
    opts: OAuthAuthorizeOptions,
    redirectUri: string,
    signal: AbortSignal,
  ): Promise<{ code: string; pkce: Pkce }> {
    const pkce = createPkce();
    const state = createState();
    const code = waitForCode(server, state, signal, this.deps.timeoutMs ?? AUTHORIZE_TIMEOUT_MS);
    await this.deps.openExternal(authorizeUrl(opts, redirectUri, pkce, state));
    return { code: await code, pkce };
  }

  private exchange(
    opts: OAuthAuthorizeOptions,
    redirectUri: string,
    signed: { code: string; pkce: Pkce },
  ) {
    const form = {
      grant_type: 'authorization_code',
      code: signed.code,
      redirect_uri: redirectUri,
      client_id: opts.clientId,
      code_verifier: signed.pkce.verifier,
    };
    return this.post(opts.tokenUrl, withSecret(form, opts.clientSecret));
  }

  private post(tokenUrl: string, form: Record<string, string>): Promise<OAuthTokens> {
    const now = (this.deps.now ?? Date.now)();
    return requestTokens(this.deps.fetch ?? globalThis.fetch, tokenUrl, form, now);
  }
}
