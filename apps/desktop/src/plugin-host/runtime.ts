import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConnectorPlugin, EnricherPlugin } from '@photobeaver/plugin-sdk';
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
import { registerEnricher } from './enricher-handlers';
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

async function loadDefaultExport(
  init: HostInit,
  options: RuntimeOptions,
): Promise<Record<string, unknown>> {
  const entry = pathToFileURL(path.join(init.pluginDir, init.main)).href;
  const module = await (options.loadModule ?? importModule)(entry);
  return (module.default ?? module) as Record<string, unknown>;
}

function hasFunctions(plugin: Record<string, unknown>, names: string[]): boolean {
  return names.every((name) => typeof plugin[name] === 'function');
}

function asConnector(plugin: Record<string, unknown>): ConnectorPlugin<unknown> {
  if (hasFunctions(plugin, ['setupSource', 'sync', 'getOriginal']))
    return plugin as unknown as ConnectorPlugin<unknown>;
  throw new Error(
    'The plugin must default-export a connector with setupSource, sync and getOriginal',
  );
}

function asEnricher(plugin: Record<string, unknown>): EnricherPlugin<unknown> {
  if (hasFunctions(plugin, ['enrich'])) return plugin as unknown as EnricherPlugin<unknown>;
  throw new Error('The plugin must default-export an enricher with enrich');
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

function connectorCapabilities(plugin: ConnectorPlugin<unknown>): HostCapabilities {
  return {
    type: 'connector',
    getThumbnail: Boolean(plugin.getThumbnail),
    testSource: Boolean(plugin.testSource),
    watch: Boolean(plugin.watch),
    enrichBatch: false,
    finalize: false,
  };
}

function enricherCapabilities(plugin: EnricherPlugin<unknown>): HostCapabilities {
  const flags = { getThumbnail: false, testSource: false, watch: false };
  return {
    type: 'enricher',
    ...flags,
    enrichBatch: Boolean(plugin.enrichBatch),
    finalize: Boolean(plugin.finalize),
  };
}

function serve(services: HostServices, raw: Record<string, unknown>): HostCapabilities {
  if (services.init.type === 'enricher') {
    const enricher = asEnricher(raw);
    registerEnricher(services, enricher);
    return enricherCapabilities(enricher);
  }
  const connector = asConnector(raw);
  registerConnector(services, connector);
  return connectorCapabilities(connector);
}

async function initialize(
  peer: RpcPeer,
  init: HostInit,
  options: RuntimeOptions,
): Promise<HostCapabilities> {
  const { fetch, grants } = installGuards(init, options.installGuards ?? true);
  const raw = await loadDefaultExport(init, options);
  const capabilities = serve({ peer, init, fetch, grants }, raw);
  const deactivate = raw.deactivate as (() => Promise<void>) | undefined;
  peer.handle(HOST_METHODS.deactivate, async () => void (await deactivate?.call(raw)));
  return capabilities;
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
