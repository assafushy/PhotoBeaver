import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { PluginContext } from '@photobeaver/plugin-sdk';

type Ctx = Pick<PluginContext, 'dataDir'> & { sourceId: string };

/**
 * Maps any id to a file-name-safe string. Distinct ids stay distinct.
 *
 * @param id - Item or source id.
 * @returns A string made of letters, digits, "_", "-" and "~" escapes.
 */
export function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, (char) => `~${char.codePointAt(0)!.toString(16)}~`);
}

/**
 * Where the preview of a picked item is stored: under the source's folder in the
 * plugin data, which core deletes when the source is removed.
 *
 * @param ctx - Context with the plugin data folder and source id.
 * @param itemId - Picker media item id.
 * @returns Absolute path of the preview file.
 */
export function previewPath(ctx: Ctx, itemId: string): string {
  return path.join(
    ctx.dataDir,
    'sources',
    safeName(ctx.sourceId),
    'previews',
    `${safeName(itemId)}.jpg`,
  );
}

/**
 * Saves preview bytes atomically.
 *
 * @param ctx - Context with the plugin data folder and source id.
 * @param itemId - Picker media item id.
 * @param bytes - Image bytes.
 */
export async function savePreview(ctx: Ctx, itemId: string, bytes: Uint8Array): Promise<void> {
  const target = previewPath(ctx, itemId);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

/**
 * Streams a saved preview.
 *
 * @param ctx - Context with the plugin data folder and source id.
 * @param itemId - Picker media item id.
 * @returns The stream, or null when no preview was saved.
 */
export async function openPreview(
  ctx: Ctx,
  itemId: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const file = previewPath(ctx, itemId);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  return Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
}
