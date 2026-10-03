import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron';

const PRELOAD_PATH = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
const RENDERER_HTML = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
const INITIAL_ROUTE = '/library';

const WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  width: 1280,
  height: 800,
  minWidth: 800,
  minHeight: 500,
  show: false,
  title: 'Photo Beaver',
  webPreferences: {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  },
};

export type LoadFailureHandler = (error: unknown) => void;

function lockDownNavigation(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function loadRenderer(window: BrowserWindow): Promise<void> {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) return window.loadURL(`${devServerUrl}#${INITIAL_ROUTE}`);
  return window.loadFile(RENDERER_HTML, { hash: INITIAL_ROUTE });
}

/**
 * Creates the hardened main window (SPEC 3.1 and 10).
 *
 * @param onLoadFailure - Called if the renderer fails to load; the window stays open.
 * @returns The window, shown once its first frame is ready.
 */
export function createMainWindow(onLoadFailure: LoadFailureHandler): BrowserWindow {
  const window = new BrowserWindow(WINDOW_OPTIONS);
  lockDownNavigation(window.webContents);
  window.once('ready-to-show', () => window.show());
  loadRenderer(window).catch(onLoadFailure);
  return window;
}
