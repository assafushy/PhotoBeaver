import type { OAuthTokens, SourceContext } from '@photobeaver/plugin-sdk';
import { AuthRequiredError } from '@photobeaver/plugin-sdk';
import { tokenStore, type TokenStore } from '@photobeaver/plugin-sdk/http';
import { readClient } from '../config';
import { TOKEN_URL } from './api';

/**
 * Token store over the source's saved tokens, refreshed with the plugin's OAuth client.
 *
 * @param ctx - Source or sync context.
 * @returns The token store.
 * @throws Error when the client ID or secret is not set in the plugin settings.
 */
export async function sourceTokens(
  ctx: Pick<SourceContext<unknown>, 'secret' | 'oauth' | 'settings'>,
): Promise<TokenStore> {
  const { clientId, clientSecret } = await readClient(ctx);
  return tokenStore(ctx, { tokenUrl: TOKEN_URL, clientId, clientSecret });
}

/**
 * Token store for tokens that were just issued and are not saved yet.
 *
 * @param tokens - Tokens from `ctx.oauth.authorize`.
 * @returns A token store that never refreshes.
 */
export function fixedTokens(tokens: OAuthTokens): TokenStore {
  return {
    accessToken: async () => tokens.accessToken,
    refresh: async () => {
      throw new AuthRequiredError('Google rejected the new sign-in');
    },
  };
}
