import type { ArchiveTree } from '@photobeaver/plugin-sdk/archive';

export type MediaSource = 'post' | 'story' | 'reel' | 'profile';

export interface ExportFile {
  path: string;
  source: MediaSource;
}

const MEDIA_FILE = /^(?:.*\/)?(?:your_instagram_activity\/media|content|media)\/[^/]+\.json$/;
const SKIPPED_FILE = /^recently_deleted/;

export const NOT_INSTAGRAM_EXPORT =
  "This folder doesn't look like an Instagram export in JSON format. Choose the folder with your extracted download or its .zip files.";

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function sourceOf(name: string): MediaSource {
  if (name.startsWith('stories')) return 'story';
  if (name.startsWith('reels')) return 'reel';
  if (name.startsWith('profile_photo')) return 'profile';
  return 'post';
}

/**
 * Lists the export JSON files that can describe photos and videos. Recently deleted
 * content is left out.
 *
 * @param tree - The opened export.
 * @returns The files sorted by path, each with the source its media came from.
 */
export function exportFiles(tree: ArchiveTree): ExportFile[] {
  return tree.entries().flatMap((entry) => {
    const name = baseName(entry.path);
    if (!MEDIA_FILE.test(entry.path) || SKIPPED_FILE.test(name)) return [];
    return [{ path: entry.path, source: sourceOf(name) }];
  });
}

/**
 * Checks that a tree looks like an Instagram data download in JSON format.
 *
 * @param tree - The opened export.
 * @throws Error with a user-facing message when no media JSON files are found.
 */
export function assertInstagramExport(tree: ArchiveTree): void {
  if (exportFiles(tree).length === 0) throw new Error(NOT_INSTAGRAM_EXPORT);
}
