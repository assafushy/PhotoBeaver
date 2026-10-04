import { createReadStream, type Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { isZipName, normalizeEntryPath } from './paths';
import type { ArchiveEntry } from './types';

export interface LooseFile {
  absolute: string;
  entry: ArchiveEntry;
}

export interface FolderContents {
  files: LooseFile[];
  zips: string[];
}

async function toLooseFile(root: string, absolute: string): Promise<LooseFile | undefined> {
  const path = normalizeEntryPath(relative(root, absolute).split(sep).join('/'));
  if (path === undefined) return undefined;
  const info = await stat(absolute);
  return { absolute, entry: { path, size: info.size, modifiedAt: info.mtime.toISOString() } };
}

function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Walks a folder recursively, splitting regular files from `.zip` files.
 *
 * @param root - Folder to walk.
 * @returns Loose files as entries, and the absolute paths of zip files in sorted order.
 */
export async function walkFolder(root: string): Promise<FolderContents> {
  const dirents: Dirent[] = await readdir(root, { recursive: true, withFileTypes: true });
  const absolute = dirents
    .filter((dirent) => dirent.isFile())
    .map((dirent) => join(dirent.parentPath, dirent.name))
    .sort(byPath);
  const zips = absolute.filter((path) => isZipName(path));
  const loose = absolute.filter((path) => !isZipName(path));
  const files = await Promise.all(loose.map((path) => toLooseFile(root, path)));
  return { files: files.flatMap((file) => file ?? []), zips };
}

/**
 * Streams a loose file from disk.
 *
 * @param absolute - Absolute file path.
 * @returns A web stream of the file contents.
 */
export function openLooseFile(absolute: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>;
}
