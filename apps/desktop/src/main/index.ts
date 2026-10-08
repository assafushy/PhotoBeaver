import { app, BrowserWindow, dialog } from 'electron';
import type { App } from './bootstrap';
import { applyUserDataOverride } from './paths';
import { registerMediaScheme } from './protocol/scheme';
import { createMainWindow } from './window';

let running: App | null = null;
let quitting = false;
let lastLogger: App['logger'] | null = null;

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
  lastLogger = running.logger;
  openWindow();
}

const SHUTDOWN_DEADLINE_MS = 5_000;

function deadline(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/**
 * Quits without relying on Electron's own quit sequence: stops core (plugin
 * hosts are killed, not asked), closes the database, then exits the process.
 * Never waits longer than the deadline (SPEC 7.3: every job is durable).
 */
async function shutdownAndExit(): Promise<void> {
  const current = running;
  running = null;
  await Promise.race([
    (current?.shutdown() ?? Promise.resolve()).catch(() => undefined),
    deadline(SHUTDOWN_DEADLINE_MS),
  ]);
  lastLogger?.info({}, 'Exiting');
  lastLogger?.flush();
  app.exit(0);
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
    lastLogger?.info({ firstRequest: !quitting }, 'Quit requested');
    lastLogger?.flush();
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void shutdownAndExit();
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
