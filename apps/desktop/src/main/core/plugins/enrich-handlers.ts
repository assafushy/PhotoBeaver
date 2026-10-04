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

function identityApi(contexts: CallContexts, raw: unknown) {
  return contexts.enrich((raw as { contextId: string }).contextId).assets;
}

function registerLookupCalls(peer: RpcPeer, contexts: CallContexts): void {
  peer.handle(
    CORE_METHODS.findByIdentity,
    (raw) => {
      const { keys, excludeAssetId } = raw as { keys: string[]; excludeAssetId?: string };
      return identityApi(contexts, raw).findByIdentity(keys, { excludeAssetId });
    },
    validatorOf(findByIdentitySchema),
  );
  peer.handle(
    CORE_METHODS.listIdentity,
    (raw) => {
      const { prefix, cursor } = raw as { prefix: string; cursor?: string };
      return identityApi(contexts, raw).listIdentity(prefix, cursor);
    },
    validatorOf(listIdentitySchema),
  );
}

function registerDuplicateCalls(peer: RpcPeer, contexts: CallContexts): void {
  peer.handle(
    CORE_METHODS.isMergeBlocked,
    (raw) => {
      const { a, b } = raw as { a: string; b: string };
      return identityApi(contexts, raw).isMergeBlocked(a, b);
    },
    validatorOf(mergeBlockedSchema),
  );
  peer.handle(
    CORE_METHODS.suggestDuplicates,
    (raw) =>
      identityApi(contexts, raw).suggestDuplicates(
        (raw as { suggestions: DuplicateSuggestion[] }).suggestions,
      ),
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
  registerLookupCalls(peer, contexts);
  registerDuplicateCalls(peer, contexts);
}
