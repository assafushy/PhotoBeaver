import type { OAuthTokens } from '@photobeaver/plugin-sdk';
import type { PickedMediaItem } from '../src/picker/types';

interface FakeSession {
  id: string;
  polls: number;
  deleted: boolean;
}

const PICKER_HOST = 'photospicker.googleapis.com';
const MEDIA_HOST = 'lh3.googleusercontent.com';
const TOKEN_HOST = 'oauth2.googleapis.com';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function error(status: number, message: string): Response {
  return json({ error: { code: status, message } }, status);
}

/**
 * Builds a picked item as the Picker API returns it.
 *
 * @param index - Item number.
 * @param type - PHOTO or VIDEO.
 * @returns The item.
 */
export function pickedItem(index: number, type: 'PHOTO' | 'VIDEO' = 'PHOTO'): PickedMediaItem {
  const id = `item-${index}`;
  const video = type === 'VIDEO';
  return {
    id,
    type,
    createTime: new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString(),
    mediaFile: {
      baseUrl: `https://${MEDIA_HOST}/${id}`,
      mimeType: video ? 'video/mp4' : 'image/jpeg',
      filename: video ? `VID_${index}.mp4` : `IMG_${index}.jpg`,
      mediaFileMetadata: { width: 4000, height: 3000, cameraMake: 'Pixel' },
    },
  };
}

/**
 * An in-memory Google Photos Picker API, OAuth token endpoint and media host,
 * served through a `fetch` function. Tokens other than `validToken` get a 401.
 */
export class FakePicker {
  validToken = 'fresh-token';
  pollsBeforeDone = 2;
  neverFinish = false;
  timeoutIn = '60s';
  readonly sessions = new Map<string, FakeSession>();
  readonly requests: string[] = [];
  readonly failingPreviews = new Set<string>();
  tokenRequests = 0;

  constructor(readonly items: PickedMediaItem[]) {}

  readonly fetch: typeof fetch = async (input, init) => this.handle(new Request(input, init));

  readonly refresh = async (): Promise<OAuthTokens> => {
    const response = await this.fetch(`https://${TOKEN_HOST}/token`, { method: 'POST' });
    return (await response.json()) as OAuthTokens;
  };

  get deleted(): string[] {
    return [...this.sessions.values()].filter((s) => s.deleted).map((s) => s.id);
  }

  addFinishedSession(id: string): void {
    this.sessions.set(id, { id, polls: this.pollsBeforeDone, deleted: false });
  }

  private handle(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    this.requests.push(`${request.method} ${url.host}${url.pathname}`);
    if (url.host === TOKEN_HOST) return this.token();
    if (request.headers.get('authorization') !== `Bearer ${this.validToken}`)
      return error(401, 'Request had invalid authentication credentials.');
    if (url.host === MEDIA_HOST) return this.media(url);
    if (url.host === PICKER_HOST) return this.picker(request.method, url);
    return error(404, 'Not found');
  }

  private token(): Response {
    this.tokenRequests++;
    return json({ accessToken: this.validToken, expiresAt: Date.now() + 3_600_000 });
  }

  private media(url: URL): Response {
    const [id, size] = decodeURIComponent(url.pathname.slice(1)).split('=');
    if (this.failingPreviews.has(id!)) return error(404, 'Not found');
    return new Response(`preview:${id}:${size}`, { headers: { 'content-type': 'image/jpeg' } });
  }

  private picker(method: string, url: URL): Response {
    const sessionId = url.pathname.match(/^\/v1\/sessions\/(.+)$/)?.[1];
    if (method === 'POST' && url.pathname === '/v1/sessions') return this.create();
    if (method === 'GET' && sessionId) return this.get(sessionId);
    if (method === 'DELETE' && sessionId) return this.remove(sessionId);
    if (method === 'GET' && url.pathname === '/v1/mediaItems') return this.list(url.searchParams);
    return error(404, 'Not found');
  }

  private live(id: string): FakeSession | undefined {
    const session = this.sessions.get(id);
    return session && !session.deleted ? session : undefined;
  }

  private body(session: FakeSession) {
    return {
      id: session.id,
      pickerUri: `https://photos.google.com/picker/${session.id}`,
      pollingConfig: { pollInterval: '0.01s', timeoutIn: this.timeoutIn },
      mediaItemsSet: !this.neverFinish && session.polls >= this.pollsBeforeDone,
    };
  }

  private create(): Response {
    const session = { id: `session-${this.sessions.size + 1}`, polls: 0, deleted: false };
    this.sessions.set(session.id, session);
    return json(this.body(session));
  }

  private get(id: string): Response {
    const session = this.live(id);
    if (!session) return error(404, 'Session not found');
    session.polls++;
    return json(this.body(session));
  }

  private remove(id: string): Response {
    const session = this.live(id);
    if (!session) return error(404, 'Session not found');
    session.deleted = true;
    return json({});
  }

  private list(params: URLSearchParams): Response {
    const session = this.live(params.get('sessionId') ?? '');
    if (!session) return error(404, 'Session not found');
    if (!this.body(session).mediaItemsSet) return error(400, 'FAILED_PRECONDITION');
    const offset = Number(params.get('pageToken') ?? '0');
    const size = Number(params.get('pageSize') ?? '25');
    const mediaItems = this.items.slice(offset, offset + size);
    const next = offset + size < this.items.length ? String(offset + size) : undefined;
    return json(next ? { mediaItems, nextPageToken: next } : { mediaItems });
  }
}
