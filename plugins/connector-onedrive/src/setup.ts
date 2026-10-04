import type { OAuthTokens, SourceContext, SourceSetupResult } from '@photobeaver/plugin-sdk';
import { fetchJson } from '@photobeaver/plugin-sdk/http';
import { folderOf, type OneDriveConfig } from './config';
import { GRAPH_URL, authorizeOptions, requireClientId } from './graph';
import type { GraphUser } from './types';

type Ctx = SourceContext<OneDriveConfig>;

function fetchUser(ctx: Ctx, tokens: OAuthTokens): Promise<GraphUser> {
  return fetchJson<GraphUser>(ctx.fetch, `${GRAPH_URL}/me?$select=userPrincipalName,mail`, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
    signal: ctx.signal,
  });
}

/**
 * Display name of a source: the account and, when set, the synced folder.
 *
 * @param user - Signed-in user from Graph.
 * @param config - Source config.
 * @returns For example `OneDrive (ana@example.com)/Pictures`.
 */
export function displayNameOf(user: GraphUser, config: OneDriveConfig): string {
  const account = user.userPrincipalName || user.mail;
  const name = account ? `OneDrive (${account})` : 'OneDrive';
  const folder = folderOf(config);
  return folder ? `${name}/${folder}` : name;
}

/**
 * Signs in with Microsoft in the browser and names the source after the account.
 *
 * @param ctx - Source context.
 * @returns Display name and the tokens to keep in the OS keychain.
 */
export async function setupOneDrive(ctx: Ctx): Promise<SourceSetupResult> {
  const clientId = await requireClientId(ctx);
  const tokens = await ctx.oauth.authorize(authorizeOptions(clientId));
  const user = await fetchUser(ctx, tokens);
  return {
    displayName: displayNameOf(user, ctx.config),
    secret: tokens as unknown as Record<string, unknown>,
  };
}
