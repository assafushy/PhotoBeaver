import path from 'node:path';
import { openArchive, type ArchiveTree } from '@photobeaver/plugin-sdk/archive';
import type { FacebookExportConfig } from './config';

/**
 * Reads the export root from the source config.
 *
 * @param config - Source config.
 * @returns The configured root.
 * @throws Error when no folder was chosen.
 */
export function requireRoot(config: Partial<FacebookExportConfig> | undefined): string {
  const root = config?.root;
  if (typeof root !== 'string' || root.trim() === '') throw new Error('No export folder selected');
  return root;
}

/**
 * Names a source after its export folder.
 *
 * @param root - The export root.
 * @returns The display name shown in the sources list.
 */
export function displayNameFor(root: string): string {
  return `Facebook export (${path.basename(root) || root})`;
}

/**
 * Opens the export, runs a callback and always closes the export.
 *
 * @param root - The export root.
 * @param use - Work to do with the open tree.
 * @returns The callback's result.
 */
export async function withTree<T>(root: string, use: (tree: ArchiveTree) => Promise<T> | T) {
  const tree = await openArchive(root);
  try {
    return await use(tree);
  } finally {
    await tree.close();
  }
}
