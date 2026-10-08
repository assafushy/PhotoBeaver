import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { schema, type LibraryDb } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { assetVisible } from '../core/access/scope';
import type { JobQueue } from '../core/jobs/job-queue';
import { PRIORITY } from '../core/jobs/job-types';
import type { OriginalCache } from '../core/originals/original-cache';
import { thumbnailDedupeKey } from '../core/sync/batch-writer';
import { faceCrop } from '../core/faces/face-crop';
import { thumbPath, type ThumbSize } from '../core/thumbnails/thumb-paths';
import type { SessionView } from '../ipc/registry';
import { parseMediaUrl, type MediaRequest } from './media-url';
import { parseRange } from './range';

export interface MediaProtocolDeps {
  db: LibraryDb;
  core: { queue: Pick<JobQueue, 'enqueue'>; originals: Pick<OriginalCache, 'ensureLocal'> };
  thumbsDir: string;
  session: SessionView;
}

const status = (code: number): Response => new Response(null, { status: code });

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

function assetOf(db: LibraryDb, media: MediaRequest): string | null {
  if (media.kind !== 'face') return media.assetId;
  const face = db
    .select({ assetId: schema.faces.assetId })
    .from(schema.faces)
    .where(eq(schema.faces.id, media.faceId))
    .get();
  return face?.assetId ?? null;
}

function inScope(deps: MediaProtocolDeps, media: MediaRequest): boolean {
  const scope = deps.session.scope();
  if (!scope) return true;
  const assetId = assetOf(deps.db, media);
  return assetId !== null && assetVisible(deps.db, scope, assetId);
}

/**
 * Answers one `pb-media` request (SPEC 8.1). The URL is validated, the session
 * must allow `assets.view`, and the asset (for a face crop, the face's asset)
 * must be in the user's scope before any file, even a cached one, is read. An
 * out-of-scope asset gets the same 404 as a missing one.
 *
 * @param deps - Database, core services, thumbs folder and session.
 * @param request - The protocol request.
 * @returns The response.
 */
export async function handleMediaRequest(
  deps: MediaProtocolDeps,
  request: Request,
): Promise<Response> {
  const media = parseMediaUrl(request.url);
  if (!media) return status(400);
  if (!deps.session.current()?.permissions.includes('assets.view')) return status(403);
  if (!inScope(deps, media)) return status(404);
  if (media.kind === 'thumb') return serveThumb(deps, media.assetId, media.size);
  if (media.kind === 'face') return serveFace(deps, media.faceId);
  return serveOriginal(deps, media.assetId, request);
}
