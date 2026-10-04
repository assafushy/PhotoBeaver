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

const SHUTDOWN_DEADLINE_MS = 10_000;
const QUIT_BACKSTOP_MS = 5_000;

function deadline(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));
}

/**
 * Stops core cleanly, then quits. Quitting must never hang: if shutdown takes
 * longer than the deadline, or Electron's own quit stalls, the process exits
 * anyway (the database is in WAL mode and every job is durable).
 */
async function shutdownThenQuit(): Promise<void> {
  const current = running;
  running = null;
  const outcome = await Promise.race([
    (current?.shutdown() ?? Promise.resolve()).then(
      () => 'done' as const,
      () => 'done' as const,
    ),
    deadline(SHUTDOWN_DEADLINE_MS),
  ]);
  if (outcome === 'timeout') current?.logger.warn({}, 'Shutdown deadline passed, exiting');
  setTimeout(() => app.exit(0), outcome === 'timeout' ? 0 : QUIT_BACKSTOP_MS);
  if (outcome === 'done') app.quit();
}

function registerAppEvents(): void {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (running && BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on('will-quit', () => lastLogger?.info({}, 'Quitting'));
  app.on('before-quit', (event) => {
    lastLogger?.info({ firstRequest: !quitting }, 'Quit requested');
    lastLogger?.flush();
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
