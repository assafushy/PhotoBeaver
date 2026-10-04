import { AuthRequiredError, RateLimitedError } from '../errors';
import type { TokenStore } from './token-store';

export interface ApiRequest extends Omit<RequestInit, 'body'> {
  /** Sent as a JSON body with the matching content type. */
  json?: unknown;
  body?: RequestInit['body'];
  /** Adds `Authorization: Bearer` and retries once with a refreshed token on 401. */
  auth?: TokenStore;
}

export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Request failed (${status}): ${body.slice(0, 300)}`);
  }
}

const DEFAULT_RETRY_SEC = 60;

function retryAfterSec(response: Response): number {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  if (Number.isFinite(seconds)) return Math.max(1, seconds);
  const date = header === null ? NaN : Date.parse(header);
  return Number.isFinite(date)
    ? Math.max(1, Math.ceil((date - Date.now()) / 1000))
    : DEFAULT_RETRY_SEC;
}

function buildInit(request: ApiRequest, token: string | undefined): RequestInit {
  const { json, auth: _auth, headers, ...rest } = request;
  const merged = new Headers(headers);
  if (token) merged.set('authorization', `Bearer ${token}`);
  if (json === undefined) return { ...rest, headers: merged };
  merged.set('content-type', 'application/json');
  return { ...rest, headers: merged, body: JSON.stringify(json) };
}

async function send(fetchFn: typeof fetch, url: string, request: ApiRequest, retried: boolean) {
  const token =
    request.auth && (retried ? await request.auth.refresh() : await request.auth.accessToken());
  return fetchFn(url, buildInit(request, token));
}

/**
 * fetch for provider APIs. Handles auth and the SDK error contract (SPEC 6.2):
 * a 401 refreshes the token once, then throws `AuthRequiredError`; a 429 (after
 * `ctx.fetch` used up its own retries) throws `RateLimitedError`; other failures
 * throw `HttpError` with the status and body.
 *
 * @param fetchFn - Usually `ctx.fetch`.
 * @param url - Request URL.
 * @param request - fetch options plus `json` and `auth`.
 * @returns The successful response.
 */
export async function apiFetch(
  fetchFn: typeof fetch,
  url: string,
  request: ApiRequest = {},
): Promise<Response> {
  let response = await send(fetchFn, url, request, false);
  if (response.status === 401 && request.auth) response = await send(fetchFn, url, request, true);
  if (response.status === 401) throw new AuthRequiredError('The provider rejected the sign-in');
  if (response.status === 429)
    throw new RateLimitedError({ retryAfterSec: retryAfterSec(response) });
  if (!response.ok) throw new HttpError(response.status, await response.text().catch(() => ''));
  return response;
}

/**
 * `apiFetch` that parses a JSON response.
 *
 * @param fetchFn - Usually `ctx.fetch`.
 * @param url - Request URL.
 * @param request - fetch options plus `json` and `auth`.
 * @returns The parsed body.
 */
export async function fetchJson<T>(
  fetchFn: typeof fetch,
  url: string,
  request: ApiRequest = {},
): Promise<T> {
  return (await (await apiFetch(fetchFn, url, request)).json()) as T;
}
