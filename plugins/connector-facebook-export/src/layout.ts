import type { ArchiveTree } from '@photobeaver/plugin-sdk/archive';

export type ExportFileKind = 'post' | 'album';

export interface ExportFile {
  path: string;
  kind: ExportFileKind;
}

const POST_FILE = /^(?:.*\/)?posts\/[^/]+\.json$/;
const LEGACY_FILE = /^(?:.*\/)?photos_and_videos\/[^/]+\.json$/;
const ALBUM_FILE = /^(?:.*\/)?(?:posts|photos_and_videos)\/album\/[^/]+\.json$/;

export const NOT_FACEBOOK_EXPORT =
  "This folder doesn't look like a Facebook export in JSON format. Choose the folder with your extracted download or its .zip files.";

function kindOf(path: string): ExportFileKind | undefined {
  if (ALBUM_FILE.test(path)) return 'album';
  if (POST_FILE.test(path) || LEGACY_FILE.test(path)) return 'post';
  return undefined;
}

/**
 * Lists the export JSON files that can describe photos and videos.
 * Post files come first so a photo found in a post and an album keeps the post as its source.
 *
 * @param tree - The opened export.
 * @returns Post files, then album files, each sorted by path.
 */
export function exportFiles(tree: ArchiveTree): ExportFile[] {
  const files = tree.entries().flatMap((entry) => {
    const kind = kindOf(entry.path);
    return kind ? [{ path: entry.path, kind }] : [];
  });
  return [
    ...files.filter((file) => file.kind === 'post'),
    ...files.filter((file) => file.kind === 'album'),
  ];
}

/**
 * Checks that a tree looks like a Facebook "Download Your Information" export in JSON format.
 *
 * @param tree - The opened export.
 * @throws Error with a user-facing message when no posts or album files are found.
 */
export function assertFacebookExport(tree: ArchiveTree): void {
  if (exportFiles(tree).length === 0) throw new Error(NOT_FACEBOOK_EXPORT);
}
