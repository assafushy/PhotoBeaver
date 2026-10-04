import type { OAuthTokens } from '@photobeaver/plugin-sdk';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function toTokens(body: TokenResponse, now: number): OAuthTokens {
  if (!body.access_token)
    throw new Error(body.error_description ?? body.error ?? 'No access token');
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in === undefined ? undefined : now + body.expires_in * 1000,
    scope: body.scope,
    tokenType: body.token_type,
  };
}

/**
 * POSTs a form to an OAuth token endpoint and parses the token response.
 *
 * @param fetchFn - fetch implementation.
 * @param tokenUrl - Token endpoint.
 * @param form - Form fields (grant type, code or refresh token, client id...).
 * @param now - Current time, for `expiresAt`.
 * @returns The tokens.
 * @throws Error with the provider's description when the request fails.
 */
export async function requestTokens(
  fetchFn: typeof fetch,
  tokenUrl: string,
  form: Record<string, string>,
  now: number,
): Promise<OAuthTokens> {
  const response = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok)
    throw new Error(
      body.error_description ?? body.error ?? `Token request failed (${response.status})`,
    );
  return toTokens(body, now);
}
