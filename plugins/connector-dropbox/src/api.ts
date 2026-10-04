import type { SourceContext } from '@photobeaver/plugin-sdk';
import { apiFetch, fetchJson, HttpError, type TokenStore } from '@photobeaver/plugin-sdk/http';
import type { DropboxAccount, ListFolderResult } from './types';

export const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
export const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
export const API_URL = 'https://api.dropboxapi.com/2';
export const CONTENT_URL = 'https://content.dropboxapi.com/2';
export const LIST_LIMIT = 500;

export interface DropboxClient {
  fetch: typeof fetch;
  auth: TokenStore;
  signal: AbortSignal;
}

/**
 * Builds a client from a source context and a token store.
 *
 * @param ctx - Source or sync context (for fetch and the abort signal).
 * @param auth - Token store that supplies bearer tokens.
 * @returns The client.
 */
export function createClient(
  ctx: Pick<SourceContext<unknown>, 'fetch' | 'signal'>,
  auth: TokenStore,
): DropboxClient {
  return { fetch: ctx.fetch, auth, signal: ctx.signal };
}

/**
 * Serializes a `Dropbox-API-Arg` header value. HTTP headers must be ASCII, so every
 * non-ASCII character is escaped as `\uXXXX`, which Dropbox decodes as JSON.
 *
 * @param arg - The argument object.
 * @returns ASCII-only JSON.
 */
export function dropboxArg(arg: unknown): string {
  return JSON.stringify(arg).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function rpc<T>(client: DropboxClient, endpoint: string, json?: unknown): Promise<T> {
  return fetchJson<T>(client.fetch, `${API_URL}${endpoint}`, {
    method: 'POST',
    json,
    auth: client.auth,
    signal: client.signal,
  });
}

/**
 * Calls a content-download endpoint, passing the argument in `Dropbox-API-Arg`.
 *
 * @param client - Dropbox client.
 * @param endpoint - Path under /2, for example `/files/download`.
 * @param arg - Endpoint argument.
 * @returns The successful response, whose body is the file content.
 */
export function download(client: DropboxClient, endpoint: string, arg: unknown): Promise<Response> {
  return apiFetch(client.fetch, `${CONTENT_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Dropbox-API-Arg': dropboxArg(arg) },
    auth: client.auth,
    signal: client.signal,
  });
}

/**
 * Fetches the signed-in account. Sends no body, as Dropbox expects for this endpoint.
 *
 * @param client - Dropbox client.
 * @returns The account.
 */
export function getCurrentAccount(client: DropboxClient): Promise<DropboxAccount> {
  return rpc<DropboxAccount>(client, '/users/get_current_account');
}

/**
 * Starts a recursive listing of a folder.
 *
 * @param client - Dropbox client.
 * @param path - "" for the whole Dropbox or "/folder".
 * @returns The first page.
 */
export function listFolder(client: DropboxClient, path: string): Promise<ListFolderResult> {
  return rpc<ListFolderResult>(client, '/files/list_folder', {
    path,
    recursive: true,
    include_deleted: false,
    limit: LIST_LIMIT,
  });
}

/**
 * Continues a listing, or lists changes since a finished listing's cursor.
 *
 * @param client - Dropbox client.
 * @param cursor - Cursor from the previous page.
 * @returns The next page.
 */
export function listFolderContinue(
  client: DropboxClient,
  cursor: string,
): Promise<ListFolderResult> {
  return rpc<ListFolderResult>(client, '/files/list_folder/continue', { cursor });
}

function errorBody(error: HttpError): { error_summary?: string; error?: { '.tag'?: string } } {
  try {
    return JSON.parse(error.body) as { error_summary?: string; error?: { '.tag'?: string } };
  } catch {
    return {};
  }
}

/**
 * Detects a Dropbox 409 conflict, optionally with a given error tag.
 *
 * @param error - Any thrown value.
 * @param tag - Error tag such as `reset`; omit to match any 409.
 * @returns True when the error is that conflict.
 */
export function isConflict(error: unknown, tag?: string): boolean {
  if (!(error instanceof HttpError) || error.status !== 409) return false;
  if (tag === undefined) return true;
  const body = errorBody(error);
  return body.error?.['.tag'] === tag || (body.error_summary ?? '').startsWith(`${tag}/`);
}
