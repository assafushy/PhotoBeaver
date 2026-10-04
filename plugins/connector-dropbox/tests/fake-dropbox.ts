import type { OAuthRefreshOptions, OAuthTokens } from '@photobeaver/plugin-sdk';

export interface FakeFile {
  id: string;
  path: string;
  rev: string;
  content: string;
  modified: string;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

interface Cursor {
  epoch: number;
  folder: string;
  log: number;
  offset?: number;
}

type Entry = Record<string, unknown> & { '.tag': string; path_lower: string };

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const conflict = (summary: string): Response =>
  json({ error_summary: summary, error: { '.tag': summary.split('/')[0] } }, 409);
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const encode = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');
const decode = (cursor: string): Cursor =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Cursor;
const under = (path: string, folder: string): boolean =>
  folder === '' || path.toLowerCase().startsWith(`${folder.toLowerCase()}/`);
const isImage = (path: string): boolean => /\.(jpe?g|png|gif|webp|heic|tiff?)$/i.test(path);

/**
 * In-memory Dropbox API served through a `fetch` function. Listing cursors encode a
 * position in the snapshot or in the change log, so they stay stable across calls.
 */
export class FakeDropbox {
  readonly files = new Map<string, FakeFile>();
  readonly requests: RecordedRequest[] = [];
  readonly email = 'beaver@example.com';
  pageSize = 4;
  validToken = 'access-1';
  private readonly log: Entry[] = [];
  private epoch = 0;
  private nextId = 1;
  private tokenSerial = 1;
  private pendingRateLimit: number | null = null;

  /** Tokens matching the currently valid access token. */
  tokens(): OAuthTokens {
    return { accessToken: this.validToken, refreshToken: 'refresh-1', tokenType: 'bearer' };
  }

  addFile(path: string, content = `bytes of ${path}`): FakeFile {
    const file = { id: `id:${this.nextId++}`, path, rev: `r${this.nextId}`, content, modified: '' };
    file.modified = new Date(Date.UTC(2026, 0, this.nextId)).toISOString().replace('.000', '');
    this.files.set(file.id, file);
    this.log.push(this.fileEntry(file));
    return file;
  }

  updateFile(id: string, content: string): void {
    const file = this.files.get(id)!;
    Object.assign(file, { content, rev: `r${this.nextId++}` });
    this.log.push(this.fileEntry(file));
  }

  moveFile(id: string, to: string): void {
    const file = this.files.get(id)!;
    this.log.push(this.deletedEntry(file.path));
    file.path = to;
    this.log.push(this.fileEntry(file));
  }

  removePath(path: string): string[] {
    const removed = [...this.files.values()].filter(
      (f) => f.path.toLowerCase() === path.toLowerCase() || under(f.path, path),
    );
    removed.forEach((f) => this.files.delete(f.id));
    this.log.push(this.deletedEntry(path));
    return removed.map((f) => f.id);
  }

  resetCursors(): void {
    this.epoch++;
  }

  expireToken(): void {
    this.validToken = `expired-${this.tokenSerial}`;
  }

  rateLimitNext(retryAfterSec: number): void {
    this.pendingRateLimit = retryAfterSec;
  }

  /** `ctx.oauth.refresh` that exchanges the refresh token at the fake token endpoint. */
  refresh = async (options: OAuthRefreshOptions): Promise<OAuthTokens> => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: options.refreshToken,
      client_id: options.clientId,
    });
    const response = await this.fetch(TOKEN_URL, { method: 'POST', body });
    const data = (await response.json()) as { access_token: string; expires_in: number };
    return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  };

  fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? init.body : (init.body?.toString() ?? null);
    const headers = new Headers(init.headers);
    this.requests.push({ url, method: init.method ?? 'GET', headers, body });
    return this.route(url, headers, body);
  }) as typeof fetch;

  private route(url: string, headers: Headers, body: string | null): Response {
    if (this.pendingRateLimit !== null) return this.rateLimited();
    if (url === TOKEN_URL) return this.issueToken();
    if (headers.get('authorization') !== `Bearer ${this.validToken}`)
      return json({ error_summary: 'expired_access_token/' }, 401);
    const path = new URL(url).pathname;
    if (path === '/2/users/get_current_account') return this.account(body);
    if (path === '/2/files/list_folder') return this.listFolder(JSON.parse(body!));
    if (path === '/2/files/list_folder/continue') return this.continue(JSON.parse(body!));
    const arg = JSON.parse(headers.get('dropbox-api-arg') ?? '{}') as Record<string, unknown>;
    if (path === '/2/files/get_thumbnail_v2') return this.thumbnail(arg);
    if (path === '/2/files/download') return this.download(String(arg.path));
    return json({ error_summary: 'not_found' }, 404);
  }

  private rateLimited(): Response {
    const retry = String(this.pendingRateLimit);
    this.pendingRateLimit = null;
    return json({ error_summary: 'too_many_requests/' }, 429, { 'retry-after': retry });
  }

  private issueToken(): Response {
    this.validToken = `access-${++this.tokenSerial}`;
    return json({ access_token: this.validToken, token_type: 'bearer', expires_in: 14400 });
  }

  private account(body: string | null): Response {
    if (body !== null) return json({ error_summary: 'unexpected body' }, 400);
    return json({ account_id: 'dbid:1', email: this.email, name: { display_name: 'Beaver' } });
  }

  private listFolder(arg: { path: string; recursive: boolean }): Response {
    if (!arg.recursive) return json({ error_summary: 'expected recursive' }, 400);
    return this.snapshotPage({
      epoch: this.epoch,
      folder: arg.path,
      log: this.log.length,
      offset: 0,
    });
  }

  private continue(arg: { cursor: string }): Response {
    const cursor = decode(arg.cursor);
    if (cursor.epoch !== this.epoch) return conflict('reset/..');
    if (cursor.offset !== undefined) return this.snapshotPage(cursor);
    const changes = this.log.slice(cursor.log).filter((e) => under(e.path_lower, cursor.folder));
    const page = changes.slice(0, this.pageSize);
    const consumed = page.length === 0 ? this.log.length : this.log.indexOf(page.at(-1)!) + 1;
    const next = { ...cursor, log: changes.length > page.length ? consumed : this.log.length };
    return json({ entries: page, cursor: encode(next), has_more: changes.length > page.length });
  }

  private snapshotPage(cursor: Cursor): Response {
    const all = this.snapshot(cursor.folder);
    const offset = cursor.offset ?? 0;
    const end = offset + this.pageSize;
    const hasMore = end < all.length;
    const next: Cursor = hasMore ? { ...cursor, offset: end } : { ...cursor, offset: undefined };
    return json({ entries: all.slice(offset, end), cursor: encode(next), has_more: hasMore });
  }

  private snapshot(folder: string): Entry[] {
    const files = [...this.files.values()].filter((f) => under(f.path, folder));
    const folders = new Set<string>();
    for (const file of files)
      for (let dir = parentOf(file.path); dir !== '' && under(dir, folder); dir = parentOf(dir))
        folders.add(dir);
    const entries = [...[...folders].map((d) => this.folderEntry(d)), ...files.map(this.fileEntry)];
    return entries.sort((a, b) => a.path_lower.localeCompare(b.path_lower));
  }

  private thumbnail(arg: Record<string, unknown>): Response {
    const resource = arg.resource as { '.tag': string; path: string };
    const file = this.lookup(resource.path);
    if (!file) return conflict('path/not_found/');
    if (!isImage(file.path)) return conflict('unsupported_extension/');
    return new Response(`thumb ${file.id} ${String(arg.size)}`);
  }

  private download(path: string): Response {
    const file = this.lookup(path);
    return file ? new Response(file.content) : conflict('path/not_found/');
  }

  private lookup(path: string): FakeFile | undefined {
    if (path.startsWith('id:')) return this.files.get(path);
    return [...this.files.values()].find((f) => f.path.toLowerCase() === path.toLowerCase());
  }

  private readonly fileEntry = (file: FakeFile): Entry => ({
    '.tag': 'file',
    id: file.id,
    name: nameOf(file.path),
    path_lower: file.path.toLowerCase(),
    path_display: file.path,
    rev: file.rev,
    size: file.content.length,
    server_modified: file.modified,
    client_modified: file.modified,
    content_hash: `hash-${file.content}`,
  });

  private folderEntry(path: string): Entry {
    return {
      '.tag': 'folder',
      id: `id:dir${path}`,
      name: nameOf(path),
      path_lower: path.toLowerCase(),
      path_display: path,
    };
  }

  private deletedEntry(path: string): Entry {
    return {
      '.tag': 'deleted',
      name: nameOf(path),
      path_lower: path.toLowerCase(),
      path_display: path,
    };
  }
}
