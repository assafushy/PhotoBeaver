import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { schema, type LibraryDb } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { thumbPath } from '../thumbnails/thumb-paths';
import type { Box } from './geometry';

export const FACE_CROP_SIZE = 256;
const PADDING = 1.6;

interface Region {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Square region around a face (with some margin), in pixels, clamped to the image.
 *
 * @param box - Face box as fractions of the image.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns The crop region.
 */
export function faceRegion(box: Box, width: number, height: number): Region {
  const side = Math.min(Math.max(box.w * width, box.h * height) * PADDING, width, height);
  const centerX = (box.x + box.w / 2) * width;
  const centerY = (box.y + box.h / 2) * height;
  const left = Math.round(Math.min(Math.max(centerX - side / 2, 0), width - side));
  const top = Math.round(Math.min(Math.max(centerY - side / 2, 0), height - side));
  const size = Math.max(1, Math.round(side));
  return { left, top, width: Math.min(size, width - left), height: Math.min(size, height - top) };
}

/**
 * Where a face crop is cached.
 *
 * @param thumbsDir - Thumbnails folder.
 * @param faceId - Face id.
 * @returns File path.
 */
export const faceCropPath = (thumbsDir: string, faceId: string): string =>
  path.join(thumbsDir, 'faces', `${faceId}.webp`);

async function sourceThumb(thumbsDir: string, assetId: string): Promise<Buffer | null> {
  return (
    (await readFile(thumbPath(thumbsDir, assetId, 1024)).catch(() => null)) ??
    (await readFile(thumbPath(thumbsDir, assetId, 256)).catch(() => null))
  );
}

async function cropFace(thumb: Buffer, box: Box): Promise<Buffer> {
  const { width = 1, height = 1 } = await sharp(thumb).metadata();
  return sharp(thumb)
    .extract(faceRegion(box, width, height))
    .resize(FACE_CROP_SIZE, FACE_CROP_SIZE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();
}

async function cache(file: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, file);
}

/**
 * A square crop of one face (People screen and viewer), cut from the asset's
 * thumbnail with sharp and cached under `thumbs/faces/`.
 *
 * @param db - Database.
 * @param thumbsDir - Thumbnails folder.
 * @param faceId - Face id (validated by the caller).
 * @returns WebP bytes, or null when the face or its thumbnail is missing.
 */
export async function faceCrop(
  db: LibraryDb,
  thumbsDir: string,
  faceId: string,
): Promise<Buffer | null> {
  const file = faceCropPath(thumbsDir, faceId);
  const cached = await readFile(file).catch(() => null);
  if (cached) return cached;
  const face = db.select().from(schema.faces).where(eq(schema.faces.id, faceId)).get();
  const thumb = face?.assetId ? await sourceThumb(thumbsDir, face.assetId) : null;
  if (!face || !thumb) return null;
  const bytes = await cropFace(thumb, JSON.parse(face.bboxJson ?? '{}') as Box);
  await cache(file, bytes);
  return bytes;
}
