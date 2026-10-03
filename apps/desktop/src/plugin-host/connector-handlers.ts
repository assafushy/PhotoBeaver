import type { ConnectorPlugin, Unsubscribe } from '@photobeaver/plugin-sdk';
import {
  CORE_METHODS,
  HOST_METHODS,
  itemCallSchema,
  sourceCallSchema,
  syncCallSchema,
  unwatchCallSchema,
  validatorOf,
  watchCallSchema,
} from '@photobeaver/shared/rpc';
import { byteChunks } from './byte-chunks';
import { sourceContext, syncContext, type HostServices } from './context';

type Connector = ConnectorPlugin<unknown>;

function registerSourceCalls(services: HostServices, plugin: Connector): void {
  const { peer } = services;
  peer.handle(
    HOST_METHODS.setupSource,
    (call, { signal }) => plugin.setupSource(sourceContext(services, call as never, signal)),
    validatorOf(sourceCallSchema),
  );
  peer.handle(
    HOST_METHODS.testSource,
    async (call, { signal }) =>
      void (await plugin.testSource?.(sourceContext(services, call as never, signal))),
    validatorOf(sourceCallSchema),
  );
  peer.handleStream(
    HOST_METHODS.sync,
    (call, { signal }) => {
      const sync = call as { cursor: string | null };
      return plugin.sync(syncContext(services, call as never, signal), sync.cursor);
    },
    validatorOf(syncCallSchema),
  );
}

type ItemKey = { sourceId: string; externalId: string };
type WatchEntry = { stop: Unsubscribe; abort: AbortController };

function registerOriginalCall(services: HostServices, plugin: Connector): void {
  services.peer.handleStream(
    HOST_METHODS.getOriginal,
    async function* (call, { signal }) {
      const { item } = call as { item: ItemKey };
      yield* byteChunks(
        await plugin.getOriginal(sourceContext(services, call as never, signal), item),
      );
    },
    validatorOf(itemCallSchema),
  );
}

function registerThumbnailCall(services: HostServices, plugin: Connector): void {
  services.peer.handleStream(
    HOST_METHODS.getThumbnail,
    async function* (call, { signal }) {
      const { item, size } = call as { item: ItemKey; size?: number };
      const stream = await plugin.getThumbnail?.(
        sourceContext(services, call as never, signal),
        item,
        size ?? 1024,
      );
      yield { found: Boolean(stream) };
      if (stream) yield* byteChunks(stream);
    },
    validatorOf(itemCallSchema),
  );
}

function registerByteCalls(services: HostServices, plugin: Connector): void {
  registerOriginalCall(services, plugin);
  registerThumbnailCall(services, plugin);
}

function registerWatchCall(
  services: HostServices,
  plugin: Connector,
  active: Map<string, WatchEntry>,
): void {
  const { peer } = services;
  peer.handle(
    HOST_METHODS.watch,
    async (raw) => {
      const call = raw as { watchId: string };
      const abort = new AbortController();
      const onChange = (batch: unknown) =>
        peer.notify(CORE_METHODS.watchChange, { watchId: call.watchId, batch });
      const stop = await plugin.watch!(
        syncContext(services, call as never, abort.signal),
        onChange,
      );
      active.set(call.watchId, { stop, abort });
    },
    validatorOf(watchCallSchema),
  );
}

function registerUnwatchCall(services: HostServices, active: Map<string, WatchEntry>): void {
  services.peer.handle(
    HOST_METHODS.unwatch,
    (raw) => {
      const { watchId } = raw as { watchId: string };
      active.get(watchId)?.abort.abort();
      active.get(watchId)?.stop();
      active.delete(watchId);
    },
    validatorOf(unwatchCallSchema),
  );
}

function registerWatchCalls(services: HostServices, plugin: Connector): void {
  const active = new Map<string, WatchEntry>();
  registerWatchCall(services, plugin, active);
  registerUnwatchCall(services, active);
}

/**
 * Serves a connector's methods over RPC (SPEC 6.5): sync as a stream of
 * batches, originals and thumbnails as byte streams, and watch subscriptions.
 *
 * @param services - Host services.
 * @param plugin - The loaded connector.
 */
export function registerConnector(services: HostServices, plugin: Connector): void {
  registerSourceCalls(services, plugin);
  registerByteCalls(services, plugin);
  if (plugin.watch) registerWatchCalls(services, plugin);
}
