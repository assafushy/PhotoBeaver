import type { PluginStorage, SyncBatch } from '@photobeaver/plugin-sdk';
import {
  contextParamsSchema,
  CORE_METHODS,
  isKnownParamsSchema,
  logParamsSchema,
  notifyParamsSchema,
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

export interface CoreHandlerDeps {
  contexts: CallContexts;
  storage: PluginStorage;
  pluginLog: CoreLog;
  settings: () => Promise<Record<string, unknown>>;
}

function registerPluginCalls(peer: RpcPeer, deps: CoreHandlerDeps): void {
  peer.onNotification(
    CORE_METHODS.log,
    (raw) => {
      const { level, msg, data } = raw as {
        level: 'debug' | 'info' | 'warn' | 'error';
        msg: string;
        data?: object;
      };
      deps.pluginLog[level](data ?? {}, msg);
    },
    validatorOf(logParamsSchema),
  );
  peer.handle(
    CORE_METHODS.storageGet,
    (raw) => deps.storage.get((raw as { key: string }).key),
    validatorOf(storageKeySchema),
  );
  peer.handle(
    CORE_METHODS.storageSet,
    (raw) => {
      const { key, value } = raw as { key: string; value: unknown };
      return deps.storage.set(key, value);
    },
    validatorOf(storageSetSchema),
  );
  peer.handle(
    CORE_METHODS.storageDelete,
    (raw) => deps.storage.delete((raw as { key: string }).key),
    validatorOf(storageKeySchema),
  );
  peer.handle(CORE_METHODS.settings, () => deps.settings());
}

function registerSourceCalls(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  const id = (raw: unknown) => (raw as { contextId: string }).contextId;
  peer.handle(
    CORE_METHODS.secretGet,
    (raw) => contexts.get(id(raw)).secret.get(),
    validatorOf(contextParamsSchema),
  );
  peer.handle(
    CORE_METHODS.secretSet,
    (raw) => contexts.get(id(raw)).secret.set((raw as { value: Record<string, unknown> }).value),
    validatorOf(secretSetSchema),
  );
  peer.handle(
    CORE_METHODS.pickDirectory,
    (raw) => contexts.get(id(raw)).ui.pickDirectory(),
    validatorOf(contextParamsSchema),
  );
  peer.onNotification(
    CORE_METHODS.notify,
    (raw) => {
      const { msg, level } = raw as { msg: string; level: 'info' | 'warn' | 'error' };
      contexts.get(id(raw)).ui.notify(msg, level);
    },
    validatorOf(notifyParamsSchema),
  );
}

function registerSyncCalls(peer: RpcPeer, { contexts }: CoreHandlerDeps): void {
  peer.handle(
    CORE_METHODS.isKnown,
    (raw) => {
      const { contextId, externalIds } = raw as { contextId: string; externalIds: string[] };
      return contexts.sync(contextId).isKnown(externalIds);
    },
    validatorOf(isKnownParamsSchema),
  );
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
  peer.onNotification(
    CORE_METHODS.watchChange,
    (raw) => {
      const { watchId, batch } = raw as { watchId: string; batch: SyncBatch };
      contexts.watch(watchId)?.(batch);
    },
    validatorOf(watchChangeSchema),
  );
}

/**
 * Serves what a plugin host may ask of core (SPEC 6.4): logging, storage,
 * settings, secrets, the folder picker, notifications, sync callbacks and
 * watch events. Every payload is validated before use (SPEC 6.5).
 *
 * @param peer - RPC peer connected to the host.
 * @param deps - Contexts, storage, plugin log and settings.
 */
export function registerCoreHandlers(peer: RpcPeer, deps: CoreHandlerDeps): void {
  registerPluginCalls(peer, deps);
  registerSourceCalls(peer, deps);
  registerSyncCalls(peer, deps);
}
