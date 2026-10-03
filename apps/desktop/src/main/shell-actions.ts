import { fileURLToPath } from 'node:url';
import { BrowserWindow, dialog, shell } from 'electron';

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
