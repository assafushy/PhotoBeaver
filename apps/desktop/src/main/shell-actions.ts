import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';

/**
 * Shows a folder picker attached to the focused window.
 *
 * @returns The chosen folder, or null when cancelled.
 */
export async function pickDirectory(): Promise<string | null> {
  const options = { properties: ['openDirectory' as const] };
  const window = BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/**
 * Opens an instance's "open in source" link: local files are revealed in the
 * file manager, web links open in the browser, anything else is ignored.
 *
 * @param url - The instance's external URL.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (url.startsWith('file:')) return shell.showItemInFolder(fileURLToPath(url));
  if (url.startsWith('https:') || url.startsWith('http:')) await shell.openExternal(url);
}

const NO_BROWSER_ENV = 'PB_E2E_NO_BROWSER';

/**
 * Opens a sign-in page or other https link from a plugin in the system browser.
 * e2e tests of unpackaged builds set `PB_E2E_NO_BROWSER` so nothing opens and
 * the sign-in simply waits.
 *
 * @param url - https URL, already checked against the plugin's allowlist.
 */
export async function openBrowser(url: string): Promise<void> {
  if (!url.startsWith('https:')) throw new Error('Only https links can be opened');
  if (!app.isPackaged && process.env[NO_BROWSER_ENV]) return;
  await shell.openExternal(url);
}

/**
 * Shows a file picker for `.pbplugin` packages.
 *
 * @returns The chosen file, or null when cancelled.
 */
export async function pickPluginPackage(): Promise<string | null> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'Photo Beaver plugin', extensions: ['pbplugin'] }],
  };
  const window = BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
