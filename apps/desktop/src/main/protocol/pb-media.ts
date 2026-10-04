import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { schema, type LibraryDb } from '@photobeaver/db';
import type { SessionUser } from '@photobeaver/shared';
import { eq } from 'drizzle-orm';
import { protocol } from 'electron';
import type { Core } from '../core/core';
import { PRIORITY } from '../core/jobs/job-types';
import { thumbnailDedupeKey } from '../core/sync/batch-writer';
import { faceCrop } from '../core/faces/face-crop';
import { thumbPath, type ThumbSize } from '../core/thumbnails/thumb-paths';
import { parseMediaUrl, PB_MEDIA_SCHEME } from './media-url';
import { parseRange } from './range';

export interface MediaProtocolDeps {
  db: LibraryDb;
  core: Core;
  thumbsDir: string;
  currentUser: () => SessionUser;
}

const status = (code: number): Response => new Response(null, { status: code });

/**
 * Registers `pb-media` as a privileged scheme. Must run before the app is ready.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PB_MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

function loadAsset(db: LibraryDb, assetId: string) {
  return db
    .select({ mime: schema.assets.mime, thumbState: schema.assets.thumbState })
    .from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .get();
}

async function serveThumb(
  deps: MediaProtocolDeps,
  assetId: string,
  size: ThumbSize,
): Promise<Response> {
  const bytes = await readFile(thumbPath(deps.thumbsDir, assetId, size)).catch(() => null);
  if (bytes)
    return new Response(bytes, {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=31536000' },
    });
  const asset = loadAsset(deps.db, assetId);
  if (asset?.thumbState === 'pending') {
    deps.core.queue.enqueue({
      kind: 'thumbnail',
      assetId,
      priority: PRIORITY.ui,
      dedupeKey: thumbnailDedupeKey(assetId),
    });
  }
  return status(404);
}

async function serveFace(deps: MediaProtocolDeps, faceId: string): Promise<Response> {
  const bytes = await faceCrop(deps.db, deps.thumbsDir, faceId);
  if (!bytes) return status(404);
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=3600' },
  });
}

function rangedResponse(
  file: string,
  size: number,
  mime: string,
  rangeHeader: string | null,
): Response {
  const range = parseRange(rangeHeader, size);
  if (range === 'invalid')
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

async function serveOriginal(
  deps: MediaProtocolDeps,
  assetId: string,
  request: Request,
): Promise<Response> {
  const asset = loadAsset(deps.db, assetId);
  if (!asset) return status(404);
  const file = await deps.core.originals.ensureLocal(assetId, request.signal);
  const { size } = await stat(file);
  return rangedResponse(
    file,
    size,
    asset.mime ?? 'application/octet-stream',
    request.headers.get('Range'),
  );
}

async function handle(deps: MediaProtocolDeps, request: Request): Promise<Response> {
  const media = parseMediaUrl(request.url);
  if (!media) return status(400);
  if (!deps.currentUser().permissions.includes('assets.view')) return status(403);
  if (media.kind === 'thumb') return serveThumb(deps, media.assetId, media.size);
  if (media.kind === 'face') return serveFace(deps, media.faceId);
  return serveOriginal(deps, media.assetId, request);
}

/**
 * Serves thumbnails, originals and face crops to the renderer (SPEC 8.1). Every request is
 * validated and checked against the session. A missing thumbnail is queued at UI
 * priority and answered with 404; the renderer retries on `thumbs.ready`.
 *
 * @param deps - Database, core services, thumbs folder and session.
 */
export function handleMediaProtocol(deps: MediaProtocolDeps): void {
  protocol.handle(PB_MEDIA_SCHEME, (request) => handle(deps, request).catch(() => status(500)));
}
