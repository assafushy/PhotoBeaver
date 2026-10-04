import type { AssetView, DuplicateSuggestion, EnrichInputOptions } from '@photobeaver/plugin-sdk';
import {
  CORE_METHODS,
  findByIdentitySchema,
  getInputParamsSchema,
  listIdentitySchema,
  mergeBlockedSchema,
  suggestDuplicatesSchema,
  validatorOf,
  type RpcPeer,
} from '@photobeaver/shared/rpc';
import type { CallContexts } from './call-contexts';

type WithContext<T> = T & { contextId: string };

function registerInputCall(peer: RpcPeer, contexts: CallContexts): void {
  peer.handle(
    CORE_METHODS.getInput,
    (raw) => {
      const { contextId, assetId, ...options } = raw as WithContext<
        { assetId: string } & EnrichInputOptions
      >;
      return contexts.enrich(contextId).getInput({ id: assetId } as AssetView, options);
    },
    validatorOf(getInputParamsSchema),
  );
}

function registerIdentityCalls(peer: RpcPeer, contexts: CallContexts): void {
  const api = (raw: unknown) => contexts.enrich((raw as { contextId: string }).contextId).assets;
  peer.handle(
    CORE_METHODS.findByIdentity,
    (raw) => {
      const { keys, excludeAssetId } = raw as { keys: string[]; excludeAssetId?: string };
      return api(raw).findByIdentity(keys, { excludeAssetId });
    },
    validatorOf(findByIdentitySchema),
  );
  peer.handle(
    CORE_METHODS.listIdentity,
    (raw) => {
      const { prefix, cursor } = raw as { prefix: string; cursor?: string };
      return api(raw).listIdentity(prefix, cursor);
    },
    validatorOf(listIdentitySchema),
  );
  peer.handle(
    CORE_METHODS.isMergeBlocked,
    (raw) => {
      const { a, b } = raw as { a: string; b: string };
      return api(raw).isMergeBlocked(a, b);
    },
    validatorOf(mergeBlockedSchema),
  );
  peer.handle(
    CORE_METHODS.suggestDuplicates,
    (raw) =>
      api(raw).suggestDuplicates((raw as { suggestions: DuplicateSuggestion[] }).suggestions),
    validatorOf(suggestDuplicatesSchema),
  );
}

/**
 * Serves enricher callbacks (SPEC 6.4 EnrichContext): input files and the
 * identity API, routed to the core-side context of the running job. The
 * permission checks live in that context.
 *
 * @param peer - RPC peer connected to the host.
 * @param contexts - Open call contexts.
 */
export function registerEnrichHandlers(peer: RpcPeer, contexts: CallContexts): void {
  registerInputCall(peer, contexts);
  registerIdentityCalls(peer, contexts);
}
