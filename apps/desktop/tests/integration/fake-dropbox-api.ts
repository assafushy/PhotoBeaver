import { createHash } from 'node:crypto';

const BLOCK = 4 * 1024 * 1024;

/**
 * Dropbox content hash: SHA-256 of the concatenated SHA-256 digests of 4 MiB blocks.
 *
 * @param bytes - File bytes.
 * @returns Lowercase hex digest.
 */
export function dropboxContentHash(bytes: Buffer): string {
  const outer = createHash('sha256');
  for (let i = 0; i < bytes.length; i += BLOCK)
    outer.update(
      createHash('sha256')
        .update(bytes.subarray(i, i + BLOCK))
        .digest(),
    );
  return outer.digest('hex');
}

interface File {
  path: string;
  bytes: Buffer;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Minimal Dropbox API plus OAuth token endpoint for core integration tests:
 * one-page recursive listing with real content hashes, downloads, and tokens
 * that can be expired or revoked.
 */
export class FakeDropboxApi {
  private readonly files: File[] = [];
  private token = 'access-1';
  private serial = 1;
  revoked = false;

  add(path: string, bytes: Buffer): void {
    this.files.push({ path, bytes });
  }

  expireAccessToken(): void {
    this.token = `access-${++this.serial}`;
  }

  fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname === '/oauth2/token')
      return this.tokenResponse(new URLSearchParams(String(init.body)));
    if (new Headers(init.headers).get('authorization') !== `Bearer ${this.token}`)
      return new Response('expired', { status: 401 });
    return this.api(url.pathname, init);
  }) as typeof fetch;

  private tokenResponse(form: URLSearchParams): Response {
    if (form.get('grant_type') === 'refresh_token' && this.revoked)
      return json({ error: 'invalid_grant', error_description: 'refresh token revoked' }, 400);
    this.revoked = false;
    return json({ access_token: this.token, refresh_token: 'refresh', expires_in: 14_400 });
  }

  private api(path: string, init: RequestInit): Response {
    if (path === '/2/users/get_current_account')
      return json({ email: 'me@example.com', name: { display_name: 'Me' } });
    if (path === '/2/files/list_folder')
      return json({
        entries: this.files.map((f, i) => this.entry(f, i)),
        cursor: 'c-1',
        has_more: false,
      });
    if (path === '/2/files/list_folder/continue')
      return json({ entries: [], cursor: 'c-1', has_more: false });
    if (path === '/2/files/download')
      return this.download(new Headers(init.headers).get('dropbox-api-arg'));
    return json(
      { error_summary: 'unsupported_extension/', error: { '.tag': 'unsupported_extension' } },
      409,
    );
  }

  private entry(file: File, index: number) {
    return {
      '.tag': 'file',
      id: `id:${index}`,
      name: file.path.split('/').pop(),
      path_display: file.path,
      path_lower: file.path.toLowerCase(),
      rev: `rev${index}`,
      size: file.bytes.length,
      server_modified: '2024-01-01T00:00:00Z',
      content_hash: dropboxContentHash(file.bytes),
    };
  }

  private download(arg: string | null): Response {
    const id = (JSON.parse(arg ?? '{}') as { path?: string }).path ?? '';
    const file = this.files[Number(id.replace('id:', ''))];
    return file
      ? new Response(new Uint8Array(file.bytes))
      : json({ error_summary: 'path/not_found/' }, 409);
  }
}
