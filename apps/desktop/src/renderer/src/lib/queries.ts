import { useQuery } from '@tanstack/react-query';

/**
 * Loads the first page of the library through the preload bridge.
 *
 * @returns The TanStack Query result for the first library page.
 */
export function useLibraryFirstPage() {
  return useQuery({
    queryKey: ['library', 'firstPage'],
    queryFn: () => window.pb.library.query({}),
  });
}
