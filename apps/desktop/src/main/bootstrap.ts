import { openLibrary, type OpenLibrary } from '@photobeaver/db';
import type { AppInfo } from '@photobeaver/shared';
import { app } from 'electron';
import { electronTransport } from './ipc/electron-transport';
import { registerHandlers } from './ipc/handlers';
import { IpcRegistry } from './ipc/registry';
import { createCoreLogger, type CoreLogger } from './logger';
import { resolveAppPaths, type AppPaths } from './paths';
import { SessionService } from './session/session-service';

export interface Core {
  library: OpenLibrary;
  logger: CoreLogger;
  shutdown(): void;
}

function buildAppInfo(paths: AppPaths): () => AppInfo {
  return () => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataDir: paths.userDataDir,
    libraryDir: paths.libraryDir,
  });
}

/**
 * Starts the core services: logger, library database, session and IPC.
 *
 * @returns Handles to the running core.
 */
export async function startCore(): Promise<Core> {
  const paths = resolveAppPaths();
  const logger = createCoreLogger(paths.logsDir);
  const library = await openLibrary({
    libraryDir: paths.libraryDir,
    migrationsFolder: paths.migrationsFolder,
  });
  logger.info({ dbPath: library.dbPath, migration: library.migration }, 'Library opened');
  const session = new SessionService(library.db);
  logger.info({ userId: session.bootstrap().id }, 'Implicit admin session started');
  const registry = new IpcRegistry(electronTransport(), () => session.current(), logger);
  registerHandlers(registry, { db: library.db, appInfo: buildAppInfo(paths) });
  return { library, logger, shutdown: () => library.close() };
}
