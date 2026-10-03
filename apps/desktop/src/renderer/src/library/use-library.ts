import type { AssetSummary, LibraryPage, ThumbUpdate } from '@photobeaver/shared';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { usePbEvent } from '../lib/use-pb-event';
import { useThumbVersions } from './thumb-store';

export const LIBRARY_QUERY_KEY = ['library'] as const;
const PAGE_SIZE = 1000;

type Pages = InfiniteData<LibraryPage, LibraryPage['nextCursor']>;

function patchThumbs(
  data: Pages | undefined,
  updates: Map<string, ThumbUpdate>,
): Pages | undefined {
  if (!data) return data;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      const update = updates.get(item.id);
      return update
        ? { ...item, width: update.width, height: update.height, thumbState: update.thumbState }
        : item;
    }),
  }));
  return { ...data, pages };
}

type LibraryQuery = ReturnType<typeof useLibraryQuery>;

function useLibraryQuery() {
  return useInfiniteQuery({
    queryKey: LIBRARY_QUERY_KEY,
    queryFn: ({ pageParam }) => window.pb.library.query({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as LibraryPage['nextCursor'],
    getNextPageParam: (last) => last.nextCursor,
  });
}

function useLoadAllPages({ hasNextPage, isFetchingNextPage, fetchNextPage }: LibraryQuery) {
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
}

function useLibraryEvents() {
  const client = useQueryClient();
  usePbEvent(
    'library.changed',
    () => void client.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY }),
  );
  usePbEvent('thumbs.ready', ({ items }) => {
    const updates = new Map(items.map((item) => [item.id, item]));
    client.setQueryData<Pages>(LIBRARY_QUERY_KEY, (data) => patchThumbs(data, updates));
    useThumbVersions.getState().bump([...updates.keys()]);
  });
}

/**
 * Loads the whole library summary list progressively (pages of 1000, keyset cursor),
 * refetches on `library.changed`, and patches tiles in place on `thumbs.ready`.
 *
 * @returns Flattened items, the total, and loading flags.
 */
export function useLibrary() {
  const query = useLibraryQuery();
  useLoadAllPages(query);
  useLibraryEvents();
  const items = useMemo<AssetSummary[]>(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  return {
    items,
    total: query.data?.pages[0]?.total ?? 0,
    isPending: query.isPending,
    isError: query.isError,
    isLoadingMore: query.hasNextPage ?? false,
  };
}
