import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeZip } from './zip-writer';

export type FileMap = Record<string, string | Buffer>;

export const POSTS = 'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json';
export const MEDIA_DIR = 'your_facebook_activity/posts/media';

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
  const root = mkdtempSync(path.join(tmpdir(), 'pb-facebook-'));
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
 * Writes files as two .zip parts, like a download split by Facebook.
 *
 * @param root - Target folder.
 * @param files - Relative path to contents; JSON goes in part 1, media alternates.
 */
export function writeZipParts(root: string, files: FileMap): void {
  const entries = Object.entries(files).map(([name, data]) => ({ name, data, method: 8 as const }));
  const half = Math.ceil(entries.length / 2);
  writeFileSync(path.join(root, 'facebook-me-part1.zip'), writeZip(entries.slice(0, half)));
  writeFileSync(path.join(root, 'facebook-me-part2.zip'), writeZip(entries.slice(half)));
}

/**
 * Builds a media object as found in the export JSON.
 *
 * @param uri - Media path relative to the export root.
 * @param extra - Extra fields such as description or media_metadata.
 * @returns The media object.
 */
export function media(uri: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { uri, creation_timestamp: 1_600_000_000, title: '', ...extra };
}

/**
 * Wraps media objects in a post with attachments, as in your_posts files.
 *
 * @param items - Media objects.
 * @param text - Post text.
 * @returns The post object.
 */
export function post(items: Record<string, unknown>[], text?: string): Record<string, unknown> {
  return {
    timestamp: 1_500_000_000,
    attachments: [{ data: items.map((item) => ({ media: item })) }],
    data: text === undefined ? [] : [{ post: text }],
    title: 'Someone added a new photo.',
  };
}

/**
 * Builds a minimal export with one post per media path, plus the media files.
 *
 * @param uris - Media paths.
 * @returns The export files.
 */
export function simpleExport(uris: string[]): FileMap {
  const files: FileMap = { [POSTS]: JSON.stringify(uris.map((uri) => post([media(uri)]))) };
  for (const uri of uris) files[uri] = `bytes of ${uri}`;
  return files;
}
