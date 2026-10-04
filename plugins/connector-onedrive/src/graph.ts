import type { OAuthAuthorizeOptions, SourceContext } from '@photobeaver/plugin-sdk';
import { apiFetch, fetchJson, tokenStore, type HttpError } from '@photobeaver/plugin-sdk/http';
import type { OneDriveConfig, OneDriveSettings } from './config';

export const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
export const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const SCOPES = ['Files.Read', 'User.Read', 'offline_access'];
export const MISSING_CLIENT_ID = "Set your Microsoft application ID in the plugin's settings first";

type Ctx = SourceContext<OneDriveConfig>;

export interface GraphClient {
  json<T>(url: string): Promise<T>;
}

/**
 * Reads the Microsoft application (client) ID from the plugin settings.
 *
 * @param ctx - Source context.
 * @returns The client ID.
 * @throws Error when it has not been set.
 */
export async function requireClientId(ctx: Ctx): Promise<string> {
  const settings = (await ctx.settings<OneDriveSettings | undefined>()) ?? {};
  const clientId = settings.clientId?.trim() ?? '';
  if (!clientId) throw new Error(MISSING_CLIENT_ID);
  return clientId;
}

/**
 * Browser sign-in options for the Microsoft identity platform (any tenant, personal accounts too).
 *
 * @param clientId - Application (client) ID.
 * @returns Options for `ctx.oauth.authorize`.
 */
export function authorizeOptions(clientId: string): OAuthAuthorizeOptions {
  return {
    authUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    scopes: SCOPES,
    redirectHost: 'localhost',
    extraParams: { prompt: 'select_account' },
  };
}

/**
 * Graph JSON client authorized with the source's stored tokens, refreshing as needed.
 *
 * @param ctx - Source or sync context.
 * @returns The client.
 */
export async function graphClient(ctx: Ctx): Promise<GraphClient> {
  const clientId = await requireClientId(ctx);
  const auth = tokenStore(ctx, { tokenUrl: TOKEN_URL, clientId, scopes: SCOPES });
  return {
    json: <T>(url: string) => fetchJson<T>(ctx.fetch, url, { auth, signal: ctx.signal }),
  };
}

/**
 * Checks for an HTTP failure with the given status.
 *
 * @param error - Any thrown value.
 * @param status - HTTP status to look for.
 * @returns True when the error is an HttpError with that status.
 */
export function isHttpStatus(error: unknown, status: number): boolean {
  return (
    error instanceof Error && error.name === 'HttpError' && (error as HttpError).status === status
  );
}

/**
 * Resolves to null instead of rejecting when the request failed with 404.
 *
 * @param request - A pending Graph request.
 * @returns The result, or null for 404.
 */
export async function orNullOnNotFound<T>(request: Promise<T>): Promise<T | null> {
  return request.catch((error: unknown) => {
    if (isHttpStatus(error, 404)) return null;
    throw error;
  });
}

/**
 * Streams a pre-authenticated download URL without sending any Authorization header.
 *
 * @param ctx - Source context.
 * @param url - Pre-authenticated URL returned by Graph.
 * @returns The response body.
 */
export async function downloadPublic(ctx: Ctx, url: string): Promise<ReadableStream<Uint8Array>> {
  const response = await apiFetch(ctx.fetch, url, { signal: ctx.signal });
  if (!response.body) throw new Error('OneDrive returned an empty download');
  return response.body;
}

/**
 * Encodes a drive item id for use in a Graph URL path.
 *
 * @param id - Drive item id.
 * @returns The URL of the item.
 */
export function itemUrl(id: string): string {
  return `${GRAPH_URL}/me/drive/items/${encodeURIComponent(id)}`;
}
