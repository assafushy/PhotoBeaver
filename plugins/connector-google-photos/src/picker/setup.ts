import type { SourceContext, SourceSetupResult } from '@photobeaver/plugin-sdk';
import { readClient, type GooglePhotosConfig } from '../config';
import { AUTH_URL, PICKER_SCOPE, TOKEN_URL } from './api';
import { sourceTokens } from './auth';

export const PICKER_DISPLAY_NAME = 'Google Photos (picked items)';

type Ctx = SourceContext<GooglePhotosConfig>;

/**
 * Signs in to Google in the browser with the read-only Picker scope.
 *
 * @param ctx - Source context.
 * @returns The display name and the tokens to keep in the OS keychain.
 * @throws Error when the OAuth client is not set in the plugin settings.
 */
export async function setupPicker(ctx: Ctx): Promise<SourceSetupResult> {
  const { clientId, clientSecret } = await readClient(ctx);
  const tokens = await ctx.oauth.authorize({
    authUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    scopes: [PICKER_SCOPE],
    extraParams: { access_type: 'offline', prompt: 'consent' },
    redirectHost: '127.0.0.1',
  });
  return { displayName: PICKER_DISPLAY_NAME, secret: { ...tokens } };
}

/**
 * Checks that the saved sign-in still yields an access token (refreshing it if needed).
 *
 * @param ctx - Source context.
 */
export async function testPicker(ctx: Ctx): Promise<void> {
  await (await sourceTokens(ctx)).accessToken();
}
