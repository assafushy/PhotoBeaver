import type { SourceContext } from '@photobeaver/plugin-sdk';
import { apiFetch, fetchJson, type TokenStore } from '@photobeaver/plugin-sdk/http';
import type { MediaItemsPage, PickingSession } from './types';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const PICKER_URL = 'https://photospicker.googleapis.com/v1';
export const PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
export const PAGE_SIZE = 100;

export interface PickerClient {
  fetch: typeof fetch;
  auth: TokenStore;
  signal: AbortSignal;
}

/**
 * Builds a Picker API client.
 *
 * @param ctx - Source or sync context (for fetch and the abort signal).
 * @param auth - Token store that supplies bearer tokens.
 * @returns The client.
 */
export function createClient(
  ctx: Pick<SourceContext<unknown>, 'fetch' | 'signal'>,
  auth: TokenStore,
): PickerClient {
  return { fetch: ctx.fetch, auth, signal: ctx.signal };
}

function call<T>(client: PickerClient, path: string, method = 'GET'): Promise<T> {
  const json = method === 'POST' ? {} : undefined;
  const request = { method, json, auth: client.auth, signal: client.signal };
  return fetchJson<T>(client.fetch, `${PICKER_URL}${path}`, request);
}

/**
 * Creates a Picker session (`sessions.create`).
 *
 * @param client - Picker client.
 * @returns The new session with its `pickerUri`.
 */
export function createSession(client: PickerClient): Promise<PickingSession> {
  return call<PickingSession>(client, '/sessions', 'POST');
}

/**
 * Reads a Picker session (`sessions.get`).
 *
 * @param client - Picker client.
 * @param sessionId - Session id.
 * @returns The session, with `mediaItemsSet` once the user is done.
 */
export function getSession(client: PickerClient, sessionId: string): Promise<PickingSession> {
  return call<PickingSession>(client, `/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * Deletes a Picker session (`sessions.delete`).
 *
 * @param client - Picker client.
 * @param sessionId - Session id.
 */
export async function deleteSession(client: PickerClient, sessionId: string): Promise<void> {
  const url = `${PICKER_URL}/sessions/${encodeURIComponent(sessionId)}`;
  await apiFetch(client.fetch, url, { method: 'DELETE', auth: client.auth, signal: client.signal });
}

/**
 * Lists one page of the items picked in a session (`mediaItems.list`).
 *
 * @param client - Picker client.
 * @param sessionId - Session id.
 * @param pageToken - Token of the page to read, empty for the first page.
 * @returns The page.
 */
export function listMediaItems(
  client: PickerClient,
  sessionId: string,
  pageToken: string,
): Promise<MediaItemsPage> {
  const query = new URLSearchParams({ sessionId, pageSize: String(PAGE_SIZE) });
  if (pageToken !== '') query.set('pageToken', pageToken);
  return call<MediaItemsPage>(client, `/mediaItems?${query.toString()}`);
}

/**
 * Downloads image bytes from a picked item's base URL, which needs the bearer token.
 *
 * @param client - Picker client.
 * @param url - Base URL with size parameters.
 * @returns The bytes.
 */
export async function downloadBytes(client: PickerClient, url: string): Promise<Uint8Array> {
  const response = await apiFetch(client.fetch, url, { auth: client.auth, signal: client.signal });
  return new Uint8Array(await response.arrayBuffer());
}
