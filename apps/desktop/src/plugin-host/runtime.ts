import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConnectorPlugin } from '@photobeaver/plugin-sdk';
import {
  HOST_METHODS,
  hostInitSchema,
  RpcPeer,
  validatorOf,
  type HostCapabilities,
  type HostInit,
  type RpcPort,
} from '@photobeaver/shared/rpc';
import { registerConnector } from './connector-handlers';
import type { HostServices } from './context';
import { FolderGrants, installFilesystemGuard } from './permissions/filesystem';
import { installNetworkGuard } from './permissions/network';
import { createRateLimitedFetch } from './permissions/rate-limited-fetch';

export type PluginModule = { default?: unknown };

export interface RuntimeOptions {
  installGuards?: boolean;
  loadModule?: (entryUrl: string) => Promise<PluginModule>;
}

const importModule = (entryUrl: string) => import(entryUrl) as Promise<PluginModule>;

async function loadPlugin(
  init: HostInit,
  options: RuntimeOptions,
): Promise<ConnectorPlugin<unknown>> {
  const entry = pathToFileURL(path.join(init.pluginDir, init.main)).href;
  const module = await (options.loadModule ?? importModule)(entry);
  const plugin = (module.default ?? module) as Partial<ConnectorPlugin<unknown>>;
  if (
    typeof plugin.sync !== 'function' ||
    typeof plugin.setupSource !== 'function' ||
    typeof plugin.getOriginal !== 'function'
  ) {
    throw new Error(
      'The plugin must default-export a connector with setupSource, sync and getOriginal',
    );
  }
  return plugin as ConnectorPlugin<unknown>;
}

function installGuards(
  init: HostInit,
  enabled: boolean,
): { fetch: typeof fetch; grants: FolderGrants } {
  const grants = new FolderGrants([
    init.dataDir,
    init.tempDir,
    init.pluginDir,
    ...init.grantedDirs,
  ]);
  if (!enabled) return { fetch: createRateLimitedFetch(globalThis.fetch, init.rateLimit), grants };
  const guardedFetch = installNetworkGuard(init.network);
  installFilesystemGuard(grants);
  return { fetch: createRateLimitedFetch(guardedFetch, init.rateLimit), grants };
}

function capabilitiesOf(plugin: ConnectorPlugin<unknown>): HostCapabilities {
  return {
    type: 'connector',
    getThumbnail: Boolean(plugin.getThumbnail),
    testSource: Boolean(plugin.testSource),
    watch: Boolean(plugin.watch),
  };
}

async function initialize(
  peer: RpcPeer,
  init: HostInit,
  options: RuntimeOptions,
): Promise<HostCapabilities> {
  const { fetch, grants } = installGuards(init, options.installGuards ?? true);
  const plugin = await loadPlugin(init, options);
  const services: HostServices = { peer, init, fetch, grants };
  registerConnector(services, plugin);
  peer.handle(HOST_METHODS.deactivate, async () => void (await plugin.deactivate?.()));
  return capabilitiesOf(plugin);
}

/**
 * Plugin host runtime (SPEC 6.5): waits for `host.init`, loads the plugin,
 * installs the permission guards and serves the plugin over RPC. Contains no
 * Electron code, so it also runs in a worker thread for tests.
 *
 * @param port - Transport to core.
 * @param options - Test hooks: skip process-wide guards, inject the plugin module.
 * @returns The RPC peer.
 */
export function startHostRuntime(port: RpcPort, options: RuntimeOptions = {}): RpcPeer {
  const peer = new RpcPeer(port);
  let initialized = false;
  peer.handle(
    HOST_METHODS.init,
    async (params) => {
      if (initialized) throw new Error('Host already initialized');
      initialized = true;
      return initialize(peer, params as HostInit, options);
    },
    validatorOf(hostInitSchema),
  );
  return peer;
}
