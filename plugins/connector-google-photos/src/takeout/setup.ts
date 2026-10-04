import type { SourceContext, SourceSetupResult } from '@photobeaver/plugin-sdk';
import { openArchive, type ArchiveTree } from '@photobeaver/plugin-sdk/archive';
import type { GooglePhotosConfig } from '../config';
import { photoFolders } from './folders';
import { takeoutDisplayName, takeoutRoot } from './root';

type Ctx = SourceContext<GooglePhotosConfig>;

async function withArchive<T>(root: string, use: (tree: ArchiveTree) => T): Promise<T> {
  const tree = await openArchive(root);
  try {
    return use(tree);
  } finally {
    await tree.close();
  }
}

function assertGooglePhotos(tree: ArchiveTree): void {
  if (photoFolders(tree.entries()).length > 0) return;
  throw new Error(`No Google Photos export found in ${tree.root}`);
}

/**
 * Checks that the folder holds a Google Photos Takeout export (extracted or .zip files).
 *
 * @param ctx - Source context.
 * @returns The display name. Takeout sources have no secret.
 * @throws Error when the folder is missing or has no Google Photos export.
 */
export async function setupTakeout(ctx: Ctx): Promise<SourceSetupResult> {
  const root = takeoutRoot(ctx.config);
  await withArchive(root, assertGooglePhotos);
  return { displayName: takeoutDisplayName(root) };
}

/**
 * Checks that the export is still readable.
 *
 * @param ctx - Source context.
 */
export async function testTakeout(ctx: Ctx): Promise<void> {
  await withArchive(takeoutRoot(ctx.config), assertGooglePhotos);
}
