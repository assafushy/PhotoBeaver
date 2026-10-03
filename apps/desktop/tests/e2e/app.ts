import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PbApi } from '@photobeaver/shared';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export type RendererGlobals = typeof globalThis & { pb: PbApi; require?: unknown };

const MAIN_ENTRY = fileURLToPath(new URL('../../out/main/index.js', import.meta.url));

/**
 * Creates a throwaway folder for a test.
 *
 * @param prefix - Folder name prefix.
 * @returns Absolute path.
 */
export const tempDir = (prefix: string): string => mkdtempSync(path.join(tmpdir(), prefix));

/**
 * Launches the built app against a given userData folder.
 *
 * @param userDataDir - userData override.
 * @param env - Extra environment variables.
 * @returns The app and its first window.
 */
export async function launchApp(
  userDataDir: string,
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, PB_USER_DATA_DIR: userDataDir, ...env },
  });
  return { app, page: await app.firstWindow() };
}

/**
 * Reads the item count shown in the library header.
 *
 * @param page - App window.
 * @returns The number, or 0 when the header is not shown.
 */
export async function libraryCount(page: Page): Promise<number> {
  const text = await page
    .getByTestId('library-count')
    .textContent({ timeout: 1000 })
    .catch(() => null);
  return text ? Number(text.replace(/[^\d]/g, '')) : 0;
}
