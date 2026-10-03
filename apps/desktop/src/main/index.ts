import { app, BrowserWindow, dialog } from 'electron';
import type { App } from './bootstrap';
import { applyUserDataOverride } from './paths';
import { registerMediaScheme } from './protocol/scheme';
import { createMainWindow } from './window';

let running: App | null = null;
let quitting = false;

function reportFatal(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('Photo Beaver could not start:', message);
  running?.logger.fatal({ err: error }, 'Startup failed');
  dialog.showErrorBox('Photo Beaver could not start', message);
  app.exit(1);
}

function openWindow(): void {
  createMainWindow((error) => running?.logger.error({ err: error }, 'Renderer failed to load'));
}

async function onReady(): Promise<void> {
  const { startApp } = await import('./bootstrap');
  running = await startApp();
  openWindow();
}

async function shutdownThenQuit(): Promise<void> {
  try {
    await running?.shutdown();
  } finally {
    running = null;
    app.quit();
  }
}

function registerAppEvents(): void {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (running && BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on('before-quit', (event) => {
    if (!running || quitting) return;
    quitting = true;
    event.preventDefault();
    void shutdownThenQuit();
  });
}

applyUserDataOverride();
registerMediaScheme();
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppEvents();
  app.whenReady().then(onReady).catch(reportFatal);
}
