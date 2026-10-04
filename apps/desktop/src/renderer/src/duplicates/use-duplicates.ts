import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePbEvent } from '../lib/use-pb-event';

const DUPLICATES_KEY = ['duplicates'] as const;
const MERGES_KEY = ['merges'] as const;

function useRefreshDuplicates(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: DUPLICATES_KEY });
    void client.invalidateQueries({ queryKey: MERGES_KEY });
    void client.invalidateQueries({ queryKey: ['library'] });
  };
}

/**
 * Open duplicate suggestions and recent merges, refreshed on `library.changed`.
 *
 * @returns Both queries.
 */
export function useDuplicates() {
  const refresh = useRefreshDuplicates();
  usePbEvent('library.changed', refresh);
  const groups = useQuery({ queryKey: DUPLICATES_KEY, queryFn: () => window.pb.duplicates.list() });
  const merges = useQuery({ queryKey: MERGES_KEY, queryFn: () => window.pb.merges.recent() });
  return { groups, merges };
}

/**
 * Merge, dismiss and undo actions; each refreshes the lists and the library.
 *
 * @returns The three mutations.
 */
export function useDuplicateActions() {
  const onSuccess = useRefreshDuplicates();
  const merge = useMutation({
    mutationFn: ({ id, keep }: { id: string; keep: string }) =>
      window.pb.duplicates.merge(id, keep),
    onSuccess,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => window.pb.duplicates.dismiss(id),
    onSuccess,
  });
  const undo = useMutation({ mutationFn: (id: string) => window.pb.merges.undo(id), onSuccess });
  return { merge, dismiss, undo };
}
