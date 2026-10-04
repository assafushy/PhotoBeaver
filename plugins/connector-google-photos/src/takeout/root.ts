import path from 'node:path';
import type { GooglePhotosConfig } from '../config';

export const MISSING_ROOT = 'Choose the folder with your Google Takeout export first';

/**
 * Reads the Takeout folder from the source config.
 *
 * @param config - Source config.
 * @returns The folder path.
 * @throws Error when no folder is set.
 */
export function takeoutRoot(config: GooglePhotosConfig): string {
  const root = config.root?.trim() ?? '';
  if (root === '') throw new Error(MISSING_ROOT);
  return root;
}

/**
 * Display name of a Takeout source.
 *
 * @param root - Takeout folder.
 * @returns "Google Takeout (<folder name>)".
 */
export function takeoutDisplayName(root: string): string {
  return `Google Takeout (${path.basename(root) || root})`;
}
