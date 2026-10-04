import path from 'node:path';
import { openLibrary, type OpenLibrary } from '@photobeaver/db';
import type { AppInfo } from '@photobeaver/shared';
import { app } from 'electron';
import { devSocketPath } from '@photobeaver/shared/dev-socket';
import { Core, type PluginSystemOptions } from './core/core';
import { DeveloperMode } from './core/plugins/developer-mode';
import { DevSocketServer } from './core/plugins/dev-socket-server';
import { ffmpegPath } from './ffmpeg';
import { electronTransport } from './ipc/electron-transport';
import { registerHandlers } from './ipc/handlers';
import { IpcRegistry } from './ipc/registry';
import { createCoreLogger, createPluginLogger, type CoreLogger } from './logger';
import { devSyncBatchDelayMs, resolveAppPaths, type AppPaths } from './paths';
import { handleMediaProtocol } from './protocol/pb-media';
import { SessionService } from './session/session-service';
import { utilityProcessLauncher } from './plugins/utility-launcher';
import { openExternalUrl, pickDirectory, pickPluginPackage } from './shell-actions';
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

function pluginSystem(paths: AppPaths): PluginSystemOptions {
  const loggers = new Map<string, ReturnType<typeof createPluginLogger>>();
  return {
    launcher: utilityProcessLauncher(paths.pluginHostEntry),
    pluginsDir: paths.pluginsDir,
    tempDir: paths.pluginTempDir,
    defaultsDir: paths.defaultPluginsDir,
    logsDir: paths.logsDir,
    pluginLog: (id) => {
      if (!loggers.has(id)) loggers.set(id, createPluginLogger(paths.logsDir, id));
      return loggers.get(id)!;
    },
  };
}

function createCore(library: OpenLibrary, paths: AppPaths, logger: CoreLogger): Core {
  return new Core({
    library,
    libraryDir: paths.libraryDir,
    pluginDataRoot: paths.pluginDataDir,
    plugins: pluginSystem(paths),
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
  developerMode: DeveloperMode;
}

function createDeveloperMode(library: OpenLibrary, core: Core, logger: CoreLogger): DeveloperMode {
  const handler = async (request: { path: string }) =>
    (await core.plugins!.loadUnpacked(request.path, null)).id;
  return new DeveloperMode(library.db, new DevSocketServer(devSocketPath(), handler, logger));
}

function registerIpc({ paths, logger, library, session, core, developerMode }: Services): void {
  const registry = new IpcRegistry(electronTransport(), () => session.current(), logger);
  registerHandlers(registry, {
    db: library.db,
    sources: core.sources,
    appInfo: buildAppInfo(paths),
    pickDirectory,
    openExternalUrl,
    plugins: {
      plugins: core.plugins!,
      developerMode,
      pickPackage: pickPluginPackage,
      pickDirectory,
    },
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
  const developerMode = createDeveloperMode(library, core, logger);
  const services: Services = { paths, logger, library, session, core, developerMode };
  registerIpc(services);
  registerMedia(services);
  core.start();
  await developerMode.start();
  const shutdown = async () => (await developerMode.stop(), await core.stop(), library.close());
  return { library, core, logger, shutdown };
}
