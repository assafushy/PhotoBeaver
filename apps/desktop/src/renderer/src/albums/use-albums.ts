import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePbEvent } from '../lib/use-pb-event';
import { LIBRARY_QUERY_KEY } from '../library/use-library';

export const ALBUMS_KEY = ['albums'] as const;

/**
 * Album cover as a URL to its 256 px thumbnail.
 *
 * @param assetId - Cover asset id.
 * @returns The `pb-media://thumb/...` URL.
 */
export const albumCoverUrl = (assetId: string): string => `pb-media://thumb/${assetId}/256`;

/**
 * Refreshes everything an album or asset edit can change.
 *
 * @returns A function that invalidates albums, the library, facets and asset details.
 */
export function useRefreshLibrary(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ALBUMS_KEY });
    void client.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
    void client.invalidateQueries({ queryKey: ['facets'] });
    void client.invalidateQueries({ queryKey: ['asset'] });
  };
}

/**
 * The albums the signed-in user can see, refreshed on `library.changed`.
 *
 * @returns The albums query.
 */
export function useAlbums() {
  const client = useQueryClient();
  usePbEvent('library.changed', () => void client.invalidateQueries({ queryKey: ALBUMS_KEY }));
  return useQuery({ queryKey: ALBUMS_KEY, queryFn: () => window.pb.albums.list() });
}

/**
 * A mutation that refreshes the albums, library and asset details when it succeeds.
 *
 * @param mutationFn - The core call.
 * @returns The mutation.
 */
export function useLibraryMutation<T, R>(mutationFn: (variables: T) => Promise<R>) {
  return useMutation({ mutationFn, onSuccess: useRefreshLibrary() });
}

type Members = { id: string; assetIds: string[] };

/**
 * Album mutations; each refreshes the albums and the library afterwards.
 *
 * @returns Create, rename, delete, add and remove mutations.
 */
export function useAlbumActions() {
  const { albums } = window.pb;
  return {
    create: useLibraryMutation((name: string) => albums.create(name)),
    rename: useLibraryMutation(({ id, name }: { id: string; name: string }) =>
      albums.rename(id, name),
    ),
    remove: useLibraryMutation((id: string) => albums.delete(id)),
    addAssets: useLibraryMutation(({ id, assetIds }: Members) => albums.addAssets(id, assetIds)),
    removeAssets: useLibraryMutation(({ id, assetIds }: Members) =>
      albums.removeAssets(id, assetIds),
    ),
  };
}
