import type { Logger, PluginContext, SourceContext, SyncContext } from '@photobeaver/plugin-sdk';
import {
  CORE_METHODS,
  type HostInit,
  type RpcPeer,
  type SourceCall,
} from '@photobeaver/shared/rpc';
import type { FolderGrants } from './permissions/filesystem';

export interface HostServices {
  peer: RpcPeer;
  init: HostInit;
  fetch: typeof fetch;
  grants: FolderGrants;
}

const notAvailable = (feature: string) => async (): Promise<never> => {
  throw new Error(`${feature} is not available until a later milestone`);
};

function logger(peer: RpcPeer): Logger {
  const send = (level: 'debug' | 'info' | 'warn' | 'error') => (msg: string, data?: object) =>
    peer.notify(CORE_METHODS.log, {
      level,
      msg: String(msg),
      data: data ? JSON.parse(JSON.stringify(data)) : undefined,
    });
  return { debug: send('debug'), info: send('info'), warn: send('warn'), error: send('error') };
}

/**
 * Plugin-wide `ctx` (SPEC 6.4); every call that needs core goes over RPC.
 *
 * @param services - Peer, init params, guarded fetch and folder grants.
 * @param signal - Cancellation for the current call.
 * @returns The context.
 */
export function pluginContext(services: HostServices, signal: AbortSignal): PluginContext {
  const { peer, init } = services;
  return {
    pluginId: init.pluginId,
    log: logger(peer),
    storage: {
      get: async <T>(key: string) =>
        ((await peer.request(CORE_METHODS.storageGet, { key })) ?? undefined) as T | undefined,
      set: async (key, value) => void (await peer.request(CORE_METHODS.storageSet, { key, value })),
      delete: async (key) => void (await peer.request(CORE_METHODS.storageDelete, { key })),
    },
    dataDir: init.dataDir,
    fetch: services.fetch,
    settings: async <T>() => (await peer.request(CORE_METHODS.settings, {})) as T,
    signal,
  };
}

async function pickDirectory(services: HostServices, contextId: string): Promise<string | null> {
  const dir = (await services.peer.request(CORE_METHODS.pickDirectory, { contextId })) as
    string | null;
  if (dir) services.grants.add(dir);
  return dir;
}

/**
 * Per-source `ctx`. `contextId` routes callbacks to the core call that created it.
 *
 * @param services - Host services.
 * @param call - Source id, config and context id from core.
 * @param signal - Cancellation for the current call.
 * @returns The source context.
 */
export function sourceContext(
  services: HostServices,
  call: SourceCall,
  signal: AbortSignal,
): SourceContext<unknown> {
  const { peer } = services;
  const { contextId } = call;
  call.grantedDirs?.forEach((dir) => services.grants.add(dir));
  return {
    ...pluginContext(services, signal),
    sourceId: call.sourceId,
    config: call.config,
    secret: {
      get: async () =>
        ((await peer.request(CORE_METHODS.secretGet, { contextId })) ?? undefined) as
          Record<string, unknown> | undefined,
      set: async (value) => void (await peer.request(CORE_METHODS.secretSet, { contextId, value })),
    },
    oauth: { authorize: notAvailable('OAuth'), refresh: notAvailable('OAuth') },
    ui: {
      pickDirectory: () => pickDirectory(services, contextId),
      notify: (msg, level = 'info') => peer.notify(CORE_METHODS.notify, { contextId, msg, level }),
    },
  };
}

/**
 * Sync `ctx`: adds progress reporting and `isKnown`.
 *
 * @param services - Host services.
 * @param call - Source call from core.
 * @param signal - Cancellation for the sync.
 * @returns The sync context.
 */
export function syncContext(
  services: HostServices,
  call: SourceCall,
  signal: AbortSignal,
): SyncContext<unknown> {
  const { peer } = services;
  const { contextId } = call;
  return {
    ...sourceContext(services, call, signal),
    reportProgress: (progress) => peer.notify(CORE_METHODS.progress, { contextId, ...progress }),
    isKnown: async (externalIds) =>
      (await peer.request(CORE_METHODS.isKnown, { contextId, externalIds })) as Awaited<
        ReturnType<SyncContext<unknown>['isKnown']>
      >,
  };
}
