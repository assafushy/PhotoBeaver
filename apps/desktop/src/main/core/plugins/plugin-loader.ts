import { mkdirSync } from 'node:fs';
import type { PluginStorage } from '@photobeaver/plugin-sdk';
import { isConnectorManifest, type PluginManifest } from '@photobeaver/shared/manifest';
import type { HostInit } from '@photobeaver/shared/rpc';
import type { Clock } from '../clock';
import type { ConnectorEntry, CoreLog } from '../connectors/registry';
import type { CallContexts } from './call-contexts';
import { registerCoreHandlers } from './core-handlers';
import { HostHandle } from './host-handle';
import type { HostLauncher } from './host-launcher';
import type { PluginStore } from './plugin-store';
import { RemoteConnector } from './remote-connector';
import { RemoteEnricher } from './remote-enricher';
import type { EnricherEntry, EnricherManifest } from '../enrich/types';

export interface LoaderDeps {
  launcher: HostLauncher;
  store: PluginStore;
  contexts: CallContexts;
  logger: CoreLog;
  pluginLog(pluginId: string): { log: CoreLog; file: string };
  storage(pluginId: string): PluginStorage;
  settings(manifest: PluginManifest): Record<string, unknown>;
  onStarted(pluginId: string): void;
  onCrashed(pluginId: string, restartInMs: number | null): void;
  onActivity(pluginId: string, text: string | null): void;
  clock?: Clock;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  installPath: string;
  handle: HostHandle;
  entry: ConnectorEntry | null;
  enricher: EnricherEntry | null;
}

const HEAVY_MEMORY_MB = 4096;
const DEFAULT_MEMORY_MB = 1024;

function memoryFor(manifest: PluginManifest): number {
  const heavy =
    manifest.permissions.gpu || (manifest.enricher && manifest.enricher.resourceClass !== 'light');
  return heavy ? HEAVY_MEMORY_MB : DEFAULT_MEMORY_MB;
}

function hostInit(deps: LoaderDeps, manifest: PluginManifest, installPath: string): HostInit {
  const dataDir = deps.store.dataDir(manifest.id);
  const tempDir = deps.store.tempDir(manifest.id);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });
  return {
    pluginId: manifest.id,
    type: manifest.type,
    pluginDir: installPath,
    main: manifest.main,
    dataDir,
    tempDir,
    network: manifest.permissions.network,
    filesystem: manifest.permissions.filesystem,
    grantedDirs: [],
    rateLimit: manifest.connector?.rateLimit,
  };
}

function createHandle(deps: LoaderDeps, manifest: PluginManifest, installPath: string): HostHandle {
  const { log, file } = deps.pluginLog(manifest.id);
  return new HostHandle({
    pluginId: manifest.id,
    launcher: deps.launcher,
    launchOptions: { pluginId: manifest.id, maxOldSpaceMb: memoryFor(manifest), logFile: file },
    init: hostInit(deps, manifest, installPath),
    registerCoreHandlers: (peer) =>
      registerCoreHandlers(peer, {
        contexts: deps.contexts,
        storage: deps.storage(manifest.id),
        pluginLog: log,
        settings: async () => deps.settings(manifest),
        status: (text) => deps.onActivity(manifest.id, text),
      }),
    onStarted: () => deps.onStarted(manifest.id),
    onCrashed: (delay) => deps.onCrashed(manifest.id, delay),
    logger: deps.logger,
    clock: deps.clock,
  });
}

/**
 * Prepares a plugin to run in its own host (SPEC 3.1): the host handle and, for
 * connectors, the registry entry that proxies calls to it. Nothing starts until
 * the first call.
 *
 * @param deps - Launcher, store, contexts and callbacks.
 * @param manifest - Validated manifest.
 * @param installPath - Folder the plugin runs from.
 * @returns The loaded plugin.
 */
export function loadPlugin(
  deps: LoaderDeps,
  manifest: PluginManifest,
  installPath: string,
): LoadedPlugin {
  const handle = createHandle(deps, manifest, installPath);
  const entry = isConnectorManifest(manifest)
    ? { manifest, plugin: new RemoteConnector(handle, deps.contexts, manifest.configSchema) }
    : null;
  const enricher = manifest.enricher
    ? { manifest: manifest as EnricherManifest, client: new RemoteEnricher(handle, deps.contexts) }
    : null;
  return { manifest, installPath, handle, entry, enricher };
}
