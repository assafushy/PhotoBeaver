import path from 'node:path';
import { openLibrary, type OpenLibrary } from '@photobeaver/db';
import type { AppInfo } from '@photobeaver/shared';
import { app } from 'electron';
import { builtinConnectors } from './builtin-connectors';
import { Core } from './core/core';
import { ffmpegPath } from './ffmpeg';
import { electronTransport } from './ipc/electron-transport';
import { registerHandlers } from './ipc/handlers';
import { IpcRegistry } from './ipc/registry';
import { createCoreLogger, type CoreLogger } from './logger';
import { devSyncBatchDelayMs, resolveAppPaths, type AppPaths } from './paths';
import { handleMediaProtocol } from './protocol/pb-media';
import { SessionService } from './session/session-service';
import { openExternalUrl, pickDirectory } from './shell-actions';
import { createWindowEventSink } from './window-events';

export interface App {
  library: OpenLibrary;
  core: Core;
  logger: CoreLogger;
  shutdown(): Promise<void>;
}

function buildAppInfo(paths: AppPaths): () => AppInfo {
  return () => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataDir: paths.userDataDir,
    libraryDir: paths.libraryDir,
  });
}

function createCore(library: OpenLibrary, paths: AppPaths, logger: CoreLogger): Core {
  return new Core({
    library,
    libraryDir: paths.libraryDir,
    pluginDataRoot: path.join(paths.userDataDir, 'plugin-data'),
    connectors: builtinConnectors(),
    events: createWindowEventSink(),
    logger,
    ffmpegPath: ffmpegPath(),
    pickDirectory,
    syncBatchDelayMs: devSyncBatchDelayMs(),
  });
}

async function openAppLibrary(paths: AppPaths, logger: CoreLogger): Promise<OpenLibrary> {
  const library = await openLibrary({
    libraryDir: paths.libraryDir,
    migrationsFolder: paths.migrationsFolder,
  });
  logger.info({ dbPath: library.dbPath, migration: library.migration }, 'Library opened');
  return library;
}

interface Services {
  paths: AppPaths;
  logger: CoreLogger;
  library: OpenLibrary;
  session: SessionService;
  core: Core;
}

function registerIpc({ paths, logger, library, session, core }: Services): void {
  const registry = new IpcRegistry(electronTransport(), () => session.current(), logger);
  registerHandlers(registry, {
    db: library.db,
    sources: core.sources,
    appInfo: buildAppInfo(paths),
    pickDirectory,
    openExternalUrl,
  });
}

function registerMedia({ paths, library, session, core }: Services): void {
  handleMediaProtocol({
    db: library.db,
    core,
    thumbsDir: path.join(paths.libraryDir, 'thumbs'),
    currentUser: () => session.current(),
  });
}

/**
 * Starts the app services: logger, library, session, core, IPC and media protocol.
 *
 * @returns Handles to the running services.
 */
export async function startApp(): Promise<App> {
  const paths = resolveAppPaths();
  const logger = createCoreLogger(paths.logsDir);
  const library = await openAppLibrary(paths, logger);
  const session = new SessionService(library.db);
  logger.info({ userId: session.bootstrap().id }, 'Implicit admin session started');
  const core = createCore(library, paths, logger);
  const services: Services = { paths, logger, library, session, core };
  registerIpc(services);
  registerMedia(services);
  core.start();
  return { library, core, logger, shutdown: async () => (await core.stop(), library.close()) };
}
