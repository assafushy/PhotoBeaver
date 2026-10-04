import type {
  OAuthAuthorizeOptions,
  OAuthRefreshOptions,
  PluginStorage,
  SyncBatch,
} from '@photobeaver/plugin-sdk';
import {
  contextParamsSchema,
  CORE_METHODS,
  isKnownParamsSchema,
  logParamsSchema,
  notifyParamsSchema,
  oauthAuthorizeSchema,
  oauthRefreshSchema,
  openExternalSchema,
  progressParamsSchema,
  secretSetSchema,
  storageKeySchema,
  storageSetSchema,
  validatorOf,
  watchChangeSchema,
  type RpcPeer,
} from '@photobeaver/shared/rpc';
import type { CoreLog } from '../connectors/registry';
import type { CallContexts } from './call-contexts';
import { registerEnrichHandlers } from './enrich-handlers';

export interface CoreHandlerDeps {
  contexts: CallContexts;
  storage: PluginStorage;
  pluginLog: CoreLog;
  settings: () => Promise<Record<string, unknown>>;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const contextIdOf = (raw: unknown): string => (raw as { contextId: string }).contextId;
const keyOf = (raw: unknown): string => (raw as { key: string }).key;
const optionsOf = <T>(raw: unknown): T => (raw as { options: T }).options;

function registerLogCall(peer: RpcPeer, deps: CoreHandlerDeps): void {
  peer.onNotification(
    CORE_METHODS.log,
    (raw) => {
      const { level, msg, data } = raw as { level: LogLevel; msg: string; data?: object };
      deps.pluginLog[level](data ?? {}, msg);
    },
    validatorOf(logParamsSchema),
  );
}

function registerStorageCalls(peer: RpcPeer, { storage }: CoreHandlerDeps): void {
  peer.handle(
    CORE_METHODS.storageGet,
    (raw) => storage.get(keyOf(raw)),
    validatorOf(storageKeySchema),
  );
  peer.handle(
    CORE_METHODS.storageSet,
    (raw) => {
      const { key, value } = raw as { key: string; value: unknown };
      return storage.set(key, value);
    },
    validatorOf(storageSetSchema),
  );
  peer.handle(
    CORE_METHODS.storageDelete,
    (raw) => storage.delete(keyOf(raw)),
    validatorOf(storageKeySchema),
  );
}

function registerPluginCalls(peer: RpcPeer, deps: CoreHandlerDeps): void {
  registerLogCall(peer, deps);
  registerStorageCalls(peer, deps);
  peer.handle(CORE_METHODS.settings, () => deps.settings());
}

function registerSecretCalls(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.handle(
    CORE_METHODS.secretGet,
    (raw) => contexts.get(contextIdOf(raw)).secret.get(),
    validatorOf(contextParamsSchema),
  );
  peer.handle(
    CORE_METHODS.secretSet,
    (raw) =>
      contexts.get(contextIdOf(raw)).secret.set((raw as { value: Record<string, unknown> }).value),
    validatorOf(secretSetSchema),
  );
}

function registerUiCalls(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.handle(
    CORE_METHODS.pickDirectory,
    (raw) => contexts.get(contextIdOf(raw)).ui.pickDirectory(),
    validatorOf(contextParamsSchema),
  );
  peer.onNotification(
    CORE_METHODS.notify,
    (raw) => {
      const { msg, level } = raw as { msg: string; level: 'info' | 'warn' | 'error' };
      contexts.get(contextIdOf(raw)).ui.notify(msg, level);
    },
    validatorOf(notifyParamsSchema),
  );
}

function registerOpenExternalCall(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.handle(
    CORE_METHODS.openExternal,
    (raw) => contexts.get(contextIdOf(raw)).ui.openExternal((raw as { url: string }).url),
    validatorOf(openExternalSchema),
  );
}

function registerOAuthCalls(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.handle(
    CORE_METHODS.oauthAuthorize,
    (raw) => contexts.get(contextIdOf(raw)).oauth.authorize(optionsOf<OAuthAuthorizeOptions>(raw)),
    validatorOf(oauthAuthorizeSchema),
  );
  peer.handle(
    CORE_METHODS.oauthRefresh,
    (raw) => contexts.get(contextIdOf(raw)).oauth.refresh(optionsOf<OAuthRefreshOptions>(raw)),
    validatorOf(oauthRefreshSchema),
  );
}

function registerSourceCalls(peer: RpcPeer, deps: CoreHandlerDeps): void {
  registerSecretCalls(peer, deps);
  registerUiCalls(peer, deps);
  registerOpenExternalCall(peer, deps);
  registerOAuthCalls(peer, deps);
}

function registerIsKnownCall(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.handle(
    CORE_METHODS.isKnown,
    (raw) => {
      const { contextId, externalIds } = raw as { contextId: string; externalIds: string[] };
      return contexts.sync(contextId).isKnown(externalIds);
    },
    validatorOf(isKnownParamsSchema),
  );
}

function registerProgressCall(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.onNotification(
    CORE_METHODS.progress,
    (raw) => {
      const { contextId, ...progress } = raw as {
        contextId: string;
        done: number;
        total?: number;
        message?: string;
      };
      contexts.sync(contextId).reportProgress(progress);
    },
    validatorOf(progressParamsSchema),
  );
}

function registerWatchChangeCall(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.onNotification(
    CORE_METHODS.watchChange,
    (raw) => {
      const { watchId, batch } = raw as { watchId: string; batch: SyncBatch };
      contexts.watch(watchId)?.(batch);
    },
    validatorOf(watchChangeSchema),
  );
}

function registerSyncCalls(peer: RpcPeer, deps: CoreHandlerDeps): void {
  registerIsKnownCall(peer, deps);
  registerProgressCall(peer, deps);
  registerWatchChangeCall(peer, deps);
}

/**
 * Serves what a plugin host may ask of core (SPEC 6.4): logging, storage,
 * settings, secrets, OAuth, the folder picker, opening links, notifications,
 * sync callbacks and watch events. Every payload is validated before use (SPEC 6.5).
 *
 * @param peer - RPC peer connected to the host.
 * @param deps - Contexts, storage, plugin log and settings.
 */
export function registerCoreHandlers(peer: RpcPeer, deps: CoreHandlerDeps): void {
  registerPluginCalls(peer, deps);
  registerSourceCalls(peer, deps);
  registerSyncCalls(peer, deps);
  registerEnrichHandlers(peer, deps.contexts);
}
