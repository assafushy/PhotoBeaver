import type { DriveItem } from '../src/types';
import type { FakeContextOptions } from '@photobeaver/plugin-sdk/testing';
import type { OAuthRefreshOptions, OAuthTokens } from '@photobeaver/plugin-sdk';

export const GRAPH_HOST = 'graph.microsoft.com';
export const DOWNLOAD_HOST = 'public.files.1drv.com';
export const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const FIRST_TOKENS: OAuthTokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };

interface Entry {
  item: DriveItem;
  version: number;
  deleted: boolean;
}

export interface RecordedRequest {
  method: string;
  url: URL;
  authorization: string | null;
}

export interface FileSpec {
  id: string;
  name: string;
  parentId?: string;
  facets?: Partial<DriveItem>;
}

const MODIFIED = '2024-05-01T10:00:00Z';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const graphError = (status: number, code: string): Response =>
  json({ error: { code, message: code } }, status);

/**
 * In-memory Microsoft Graph and Microsoft identity platform, served through a `fetch` function.
 */
export class FakeGraph {
  readonly requests: RecordedRequest[] = [];
  readonly validTokens = new Set([FIRST_TOKENS.accessToken]);
  pageSize = 2;
  customThumbnails = true;
  private readonly entries = new Map<string, Entry>();
  private version = 0;
  private issued = 1;
  private expiredUpTo = 0;
  private throttled = 0;
  private retryAfter = '1';

  constructor() {
    this.put({ id: 'root', name: 'root', root: {}, folder: {} });
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    this.requests.push({ method, url, authorization: headers.get('authorization') });
    if (url.hostname === 'login.microsoftonline.com') return this.token(init);
    if (url.hostname === DOWNLOAD_HOST) return new Response(`bytes of ${url.pathname}`);
    if (url.hostname !== GRAPH_HOST) return new Response('unknown host', { status: 502 });
    return this.graph(url, headers);
  };

  addFolder(id: string, name: string, parentId = 'root'): void {
    this.put({ id, name, folder: {}, parentReference: { id: parentId } });
  }

  addFile(spec: FileSpec): void {
    const { id, name, parentId = 'root', facets = {} } = spec;
    this.put({
      id,
      name,
      size: 1000,
      webUrl: `https://onedrive.live.com/?id=${id}`,
      lastModifiedDateTime: MODIFIED,
      file: { mimeType: 'image/jpeg', hashes: { quickXorHash: `qx-${id}=` } },
      parentReference: { id: parentId },
      ...facets,
    });
  }

  touch(id: string): void {
    this.put({ ...this.entries.get(id)!.item });
  }

  remove(id: string): void {
    for (const child of this.children(id)) this.remove(child.id);
    const entry = this.entries.get(id)!;
    this.entries.set(id, { ...entry, deleted: true, version: ++this.version });
  }

  expireDeltaTokens(): void {
    this.expiredUpTo = this.version;
  }

  expireAccessTokens(): void {
    this.validTokens.clear();
  }

  throttleNext(count: number, retryAfterSec: number): void {
    this.throttled = count;
    this.retryAfter = String(retryAfterSec);
  }

  private put(item: DriveItem): void {
    const version = ++this.version;
    const tagged = item.file
      ? { ...item, cTag: `c-${item.id}-${version}`, eTag: `e-${version}` }
      : item;
    this.entries.set(item.id, { item: tagged, version, deleted: false });
  }

  private children(id: string): DriveItem[] {
    return [...this.entries.values()]
      .filter((entry) => !entry.deleted && entry.item.parentReference?.id === id)
      .map((entry) => entry.item);
  }

  private token(init: RequestInit | undefined): Response {
    const form = new URLSearchParams(String(init?.body ?? ''));
    if (form.get('grant_type') !== 'refresh_token') return graphError(400, 'invalid_grant');
    const n = ++this.issued;
    this.validTokens.add(`access-${n}`);
    return json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600 });
  }

  private graph(url: URL, headers: Headers): Response {
    if (this.throttled > 0) {
      this.throttled--;
      return json({ error: { code: 'throttled' } }, 429, { 'retry-after': this.retryAfter });
    }
    const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!this.validTokens.has(token)) return graphError(401, 'InvalidAuthenticationToken');
    return this.route(url);
  }

  private route(url: URL): Response {
    const path = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ''));
    if (path === '/me') return json({ userPrincipalName: 'ana@example.com', mail: null });
    if (path === '/me/drive') return json({ id: 'drive-1' });
    const delta = path.match(/^\/me\/drive\/(root|root:\/.*:)\/delta$/);
    if (delta) return this.delta(url, this.scopeId(delta[1]!));
    const root = path.match(/^\/me\/drive\/(root|root:\/.*:)$/);
    if (root) return this.rootItem(this.scopeId(root[1]!));
    const thumb = path.match(/^\/me\/drive\/items\/([^/]+)\/thumbnails\/0\/([^/]+)$/);
    if (thumb) return this.thumbnail(thumb[1]!, thumb[2]!);
    const item = path.match(/^\/me\/drive\/items\/([^/]+)$/);
    if (item) return this.download(item[1]!);
    return graphError(404, 'itemNotFound');
  }

  private scopeId(segment: string): string | undefined {
    if (segment === 'root') return 'root';
    const names = segment.slice('root:/'.length, -1).split('/');
    let current: string | undefined = 'root';
    for (const name of names)
      current = this.children(current!).find((child) => child.name === name)?.id;
    return current;
  }

  private rootItem(id: string | undefined): Response {
    return id ? json({ id }) : graphError(404, 'itemNotFound');
  }

  private live(id: string): DriveItem | undefined {
    const entry = this.entries.get(id);
    return entry && !entry.deleted ? entry.item : undefined;
  }

  private thumbnail(id: string, size: string): Response {
    if (!this.live(id)) return graphError(404, 'itemNotFound');
    if (size.startsWith('c') && !this.customThumbnails) return graphError(404, 'itemNotFound');
    return json({ width: 800, height: 600, url: `https://${DOWNLOAD_HOST}/thumb/${id}/${size}` });
  }

  private download(id: string): Response {
    if (!this.live(id)) return graphError(404, 'itemNotFound');
    return json({ id, '@microsoft.graph.downloadUrl': `https://${DOWNLOAD_HOST}/download/${id}` });
  }

  private inScope(item: DriveItem, scope: string): boolean {
    let current: string | undefined = item.id;
    for (let depth = 0; current && depth < 50; depth++) {
      if (current === scope) return true;
      current = this.entries.get(current)?.item.parentReference?.id;
    }
    return false;
  }

  private changes(scope: string, since: number): DriveItem[] {
    return [...this.entries.values()]
      .filter((entry) => entry.version > since && this.inScope(entry.item, scope))
      .filter((entry) => since > 0 || !entry.deleted)
      .sort((a, b) => a.version - b.version)
      .map((entry) => (entry.deleted ? this.tombstone(entry.item) : entry.item));
  }

  private tombstone(item: DriveItem): DriveItem {
    const facet = item.folder ? { folder: {} } : {};
    return {
      id: item.id,
      deleted: { state: 'deleted' },
      parentReference: item.parentReference,
      ...facet,
    };
  }

  private delta(url: URL, scope: string | undefined): Response {
    if (!scope) return graphError(404, 'itemNotFound');
    const token = url.searchParams.get('token');
    const since = Number(token ?? 0);
    if (since > 0 && since <= this.expiredUpTo)
      return graphError(410, 'resyncChangesApplyDifferences');
    const skip = Number(url.searchParams.get('skip') ?? 0);
    const all = this.changes(scope, since);
    const value = all.slice(skip, skip + this.pageSize);
    const link = (params: string) => `https://${GRAPH_HOST}${url.pathname}?${params}`;
    if (skip + this.pageSize < all.length)
      return json({
        value,
        '@odata.nextLink': link(`token=${since}&skip=${skip + this.pageSize}`),
      });
    return json({ value, '@odata.deltaLink': link(`token=${this.version}`) });
  }
}

/**
 * A refresh function that calls the fake token endpoint, like the core OAuth broker would.
 *
 * @param graph - The fake.
 * @returns An `oauth.refresh` implementation.
 */
export function fakeRefresh(graph: FakeGraph): (opts: OAuthRefreshOptions) => Promise<OAuthTokens> {
  return async (opts) => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
    });
    const response = await graph.fetch(TOKEN_ENDPOINT, { method: 'POST', body: body.toString() });
    if (!response.ok) throw new Error('invalid_grant');
    const data = (await response.json()) as { access_token: string; refresh_token: string };
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
  };
}

/**
 * Fake host options wired to a FakeGraph: its fetch, signed-in tokens and a client ID.
 *
 * @param graph - The fake.
 * @returns Context options for `runSync`, `createFakeSyncContext` or the contract suite.
 */
export function graphContext(graph: FakeGraph): Omit<FakeContextOptions, 'known'> {
  return {
    fetch: graph.fetch,
    secret: { ...FIRST_TOKENS },
    settings: { clientId: 'c' },
    oauth: { refresh: fakeRefresh(graph) },
  };
}

/**
 * Seeds a small library: two folders, photos, a video and a non-media file.
 *
 * @param graph - The fake to fill.
 * @returns The ids of the media items.
 */
export function seedLibrary(graph: FakeGraph): string[] {
  graph.addFolder('f-pics', 'Pictures');
  graph.addFolder('f-2024', '2024', 'f-pics');
  graph.addFile({
    id: 'p1',
    name: 'beach.jpg',
    parentId: 'f-2024',
    facets: {
      photo: { takenDateTime: '2024-07-01T12:00:00Z' },
      image: { width: 4000, height: 3000 },
      location: { latitude: 32.1, longitude: 34.8 },
    },
  });
  graph.addFile({ id: 'p2', name: 'cat.heic', parentId: 'f-pics', facets: { photo: {} } });
  graph.addFile({
    id: 'p3',
    name: 'scan.png',
    parentId: 'f-pics',
    facets: { file: { mimeType: 'image/png' } },
  });
  graph.addFile({
    id: 'v1',
    name: 'clip.mp4',
    parentId: 'f-2024',
    facets: {
      file: { mimeType: 'video/mp4', hashes: { quickXorHash: 'qx-v1=' } },
      video: { duration: 12_345, width: 1920, height: 1080 },
    },
  });
  graph.addFile({ id: 'p4', name: 'root-photo.jpg', facets: { photo: {} } });
  graph.addFile({ id: 'doc', name: 'notes.txt', facets: { file: { mimeType: 'text/plain' } } });
  return ['p1', 'p2', 'p3', 'v1', 'p4'];
}
