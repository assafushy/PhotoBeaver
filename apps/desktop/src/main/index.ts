import { app, BrowserWindow, dialog } from 'electron';
import { startCore, type Core } from './bootstrap';
import { applyUserDataOverride } from './paths';
import { createMainWindow } from './window';

let core: Core | null = null;

function reportFatal(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('Photo Beaver could not start:', message);
  core?.logger.fatal({ err: error }, 'Startup failed');
  dialog.showErrorBox('Photo Beaver could not start', message);
  app.exit(1);
}

function openWindow(): void {
  createMainWindow((error) => core?.logger.error({ err: error }, 'Renderer failed to load'));
}

async function onReady(): Promise<void> {
  core = await startCore();
  openWindow();
}

function registerAppEvents(): void {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (core && BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on('will-quit', () => core?.shutdown());
}

applyUserDataOverride();
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppEvents();
  app.whenReady().then(onReady).catch(reportFatal);
}
