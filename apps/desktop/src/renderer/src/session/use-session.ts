import type { Permission, SessionState } from '@photobeaver/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePbEvent } from '../lib/use-pb-event';

export const SESSION_KEY = ['session'] as const;

/**
 * Who is signed in. On `session.changed` (sign-in, lock, switch, role change)
 * every cached query is dropped so nothing from the previous user lingers.
 *
 * @returns The session query.
 */
export function useSession() {
  const client = useQueryClient();
  usePbEvent('session.changed', () => void client.resetQueries());
  return useQuery<SessionState>({
    queryKey: SESSION_KEY,
    queryFn: () => window.pb.session.current(),
  });
}

/**
 * Whether the signed-in user has a permission. The UI hides what they can't
 * use; core enforces it anyway (SPEC 3.3).
 *
 * @param permission - Permission name.
 * @returns True when allowed.
 */
export function useCan(permission: Permission): boolean {
  const { data } = useSession();
  return data?.user?.permissions.includes(permission) ?? false;
}
