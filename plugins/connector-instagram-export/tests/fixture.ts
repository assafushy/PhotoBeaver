import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeZip } from './zip-writer';

export type FileMap = Record<string, string | Buffer>;
export type Json = Record<string, unknown>;

export const ACTIVITY = 'your_instagram_activity/media';
export const POSTS = `${ACTIVITY}/posts_1.json`;
export const MEDIA_DIR = 'media/posts/202401';

export interface TempDir {
  root: string;
  cleanup: () => void;
}

/**
 * Creates an empty temp folder.
 *
 * @returns The folder and a cleanup function.
 */
export function tempDir(): TempDir {
  const root = mkdtempSync(path.join(tmpdir(), 'pb-instagram-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Writes files under a folder, creating parent folders.
 *
 * @param root - Target folder.
 * @param files - Relative path to contents.
 */
export function writeFiles(root: string, files: FileMap): void {
  for (const [relative, data] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, data);
  }
}

/**
 * Writes files as two .zip parts, like a download split by Instagram.
 *
 * @param root - Target folder.
 * @param files - Relative path to contents, split in half across the parts.
 */
export function writeZipParts(root: string, files: FileMap): void {
  const entries = Object.entries(files).map(([name, data]) => ({ name, data, method: 8 as const }));
  const half = Math.ceil(entries.length / 2);
  writeFileSync(path.join(root, 'instagram-me-part1.zip'), writeZip(entries.slice(0, half)));
  writeFileSync(path.join(root, 'instagram-me-part2.zip'), writeZip(entries.slice(half)));
}

/**
 * Builds a media object as found in the export JSON.
 *
 * @param uri - Media path relative to the export root.
 * @param extra - Extra fields such as title or media_metadata.
 * @returns The media object.
 */
export function media(uri: string, extra: Json = {}): Json {
  return { uri, creation_timestamp: 1_600_000_000, title: '', ...extra };
}

/**
 * Builds a carousel post: title and time on the post, media titles empty.
 *
 * @param uris - Media paths.
 * @param title - Post caption.
 * @returns The post object.
 */
export function carousel(uris: string[], title: string): Json {
  return { media: uris.map((uri) => media(uri)), title, creation_timestamp: 1_500_000_000 };
}

/**
 * Builds a minimal export with one single-media post per path, plus the media files.
 *
 * @param uris - Media paths.
 * @returns The export files.
 */
export function simpleExport(uris: string[]): FileMap {
  const posts = uris.map((uri) => ({ media: [media(uri)] }));
  const files: FileMap = { [POSTS]: JSON.stringify(posts) };
  for (const uri of uris) files[uri] = `bytes of ${uri}`;
  return files;
}
