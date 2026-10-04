import type { OAuthTokens, SourceContext } from '@photobeaver/plugin-sdk';
import { AuthRequiredError } from '@photobeaver/plugin-sdk';
import { tokenStore, type TokenStore } from '@photobeaver/plugin-sdk/http';
import { TOKEN_URL } from './api';
import { readClientId } from './config';

/**
 * Token store over the source's saved tokens, refreshed with the plugin's app key.
 *
 * @param ctx - Source or sync context.
 * @returns The token store.
 */
export async function sourceTokens(
  ctx: Pick<SourceContext<unknown>, 'secret' | 'oauth' | 'settings'>,
): Promise<TokenStore> {
  const clientId = await readClientId(ctx);
  return tokenStore(ctx, { tokenUrl: TOKEN_URL, clientId });
}

/**
 * Token store for tokens that were just issued and are not saved yet (during setup).
 *
 * @param tokens - Tokens from `ctx.oauth.authorize`.
 * @returns A token store that never refreshes.
 */
export function fixedTokens(tokens: OAuthTokens): TokenStore {
  return {
    accessToken: async () => tokens.accessToken,
    refresh: async () => {
      throw new AuthRequiredError('Dropbox rejected the new sign-in');
    },
  };
}
