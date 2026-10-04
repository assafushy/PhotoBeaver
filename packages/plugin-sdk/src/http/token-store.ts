import type { OAuthTokens, SourceContext } from '../context';
import { AuthRequiredError } from '../errors';

export interface TokenStoreOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  /** Refresh this long before expiry. Default 60 s. */
  skewMs?: number;
}

export interface TokenStore {
  /** A valid access token, refreshed first when it is about to expire. */
  accessToken(): Promise<string>;
  /** Forces a refresh (after a 401) and returns the new access token. */
  refresh(): Promise<string>;
}

type Ctx = Pick<SourceContext<unknown>, 'secret' | 'oauth'>;

function tokensOf(secret: Record<string, unknown> | undefined): OAuthTokens {
  if (!secret || typeof secret.accessToken !== 'string')
    throw new AuthRequiredError('Sign in again to continue');
  return secret as unknown as OAuthTokens;
}

async function refreshTokens(ctx: Ctx, options: TokenStoreOptions, current: OAuthTokens) {
  if (!current.refreshToken) throw new AuthRequiredError('The sign-in expired');
  const fresh = await ctx.oauth
    .refresh({
      tokenUrl: options.tokenUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scopes: options.scopes,
      refreshToken: current.refreshToken,
    })
    .catch((error: unknown) => {
      if (error instanceof TypeError) throw error;
      throw new AuthRequiredError(error instanceof Error ? error.message : 'The sign-in expired');
    });
  const merged = { ...current, ...fresh, refreshToken: fresh.refreshToken ?? current.refreshToken };
  await ctx.secret.set(merged as unknown as Record<string, unknown>);
  return merged.accessToken;
}

/**
 * OAuth tokens kept in the source's secret (`{ accessToken, refreshToken, expiresAt }`,
 * as returned by `ctx.oauth.authorize`). Refreshes before expiry and saves rotated
 * tokens. A missing secret or a rejected refresh throws `AuthRequiredError`, which
 * puts the source into "Needs reconnecting"; network failures are rethrown so the
 * sync simply retries.
 *
 * @param ctx - Source or sync context.
 * @param options - Token endpoint and client.
 * @returns The token store.
 */
export function tokenStore(ctx: Ctx, options: TokenStoreOptions): TokenStore {
  const skew = options.skewMs ?? 60_000;
  const refresh = async () => refreshTokens(ctx, options, tokensOf(await ctx.secret.get()));
  return {
    refresh,
    accessToken: async () => {
      const tokens = tokensOf(await ctx.secret.get());
      const expiring = tokens.expiresAt !== undefined && tokens.expiresAt - skew <= Date.now();
      return expiring ? refresh() : tokens.accessToken;
    },
  };
}
