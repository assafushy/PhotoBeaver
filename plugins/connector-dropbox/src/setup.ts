import type { SourceContext, SourceSetupResult } from '@photobeaver/plugin-sdk';
import { AUTH_URL, createClient, getCurrentAccount, TOKEN_URL } from './api';
import { fixedTokens, sourceTokens } from './auth';
import { normalizeFolder, readClientId, type DropboxConfig } from './config';

export const SCOPES = ['files.metadata.read', 'files.content.read', 'account_info.read'];
export const REDIRECT_PORTS = [53682, 53683, 53684];

type Ctx = SourceContext<DropboxConfig>;

function displayName(email: string, folder: string): string {
  const base = `Dropbox (${email})`;
  return folder === '' ? base : `${base} ${folder}`;
}

/**
 * Signs in to Dropbox in the browser and names the source after the account.
 *
 * @param ctx - Source context.
 * @returns The display name and the tokens to keep in the OS keychain.
 * @throws Error when the app key is not set in the plugin settings.
 */
export async function setupDropbox(ctx: Ctx): Promise<SourceSetupResult> {
  const clientId = await readClientId(ctx);
  const tokens = await ctx.oauth.authorize({
    authUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    scopes: SCOPES,
    extraParams: { token_access_type: 'offline' },
    redirectHost: '127.0.0.1',
    redirectPorts: REDIRECT_PORTS,
  });
  const account = await getCurrentAccount(createClient(ctx, fixedTokens(tokens)));
  return {
    displayName: displayName(account.email, normalizeFolder(ctx.config.folder)),
    secret: { ...tokens },
  };
}

/**
 * Checks that the saved sign-in still works with one cheap call.
 *
 * @param ctx - Source context.
 */
export async function testDropbox(ctx: Ctx): Promise<void> {
  await getCurrentAccount(createClient(ctx, await sourceTokens(ctx)));
}
