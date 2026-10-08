import type { PbApi } from '@photobeaver/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const USERS_KEY = ['users', 'list'] as const;

export type NewUser = Parameters<PbApi['users']['create']>[0];
export type UserChanges = Parameters<PbApi['users']['update']>[0];
export type Scopes = Parameters<PbApi['users']['setScopes']>[1];

/**
 * Every account in the library (Admin only).
 *
 * @returns The users query.
 */
export function useUsers() {
  return useQuery({ queryKey: USERS_KEY, queryFn: () => window.pb.users.list() });
}

function useUserMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  onSuccess: () => void,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => (onSuccess(), void client.invalidateQueries({ queryKey: USERS_KEY })),
  });
}

/**
 * Create, update, delete and scope accounts; each refreshes the list.
 *
 * @param onSuccess - Called after a change is saved.
 * @returns The mutations.
 */
export function useUserActions(onSuccess: () => void) {
  const { users } = window.pb;
  return {
    create: useUserMutation((user: NewUser) => users.create(user), onSuccess),
    update: useUserMutation((changes: UserChanges) => users.update(changes), onSuccess),
    remove: useUserMutation((id: string) => users.delete(id), onSuccess),
    setScopes: useUserMutation(
      ({ id, scopes }: { id: string; scopes: Scopes }) => users.setScopes(id, scopes),
      onSuccess,
    ),
  };
}

/**
 * The sources and albums an Admin can limit a user to.
 *
 * @returns Sources and albums, empty while loading or if unavailable.
 */
export function useScopeChoices() {
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => window.pb.sources.list() });
  const albums = useQuery({ queryKey: ['albums'], queryFn: () => window.pb.albums.list() });
  return { sources: sources.data ?? [], albums: albums.data ?? [] };
}
