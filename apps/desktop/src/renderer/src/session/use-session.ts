import type { Permission, SessionState } from '@photobeaver/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePbEvent } from '../lib/use-pb-event';

export const SESSION_KEY = ['session'] as const;

/**
 * Who is signed in.
 *
 * @returns The session query.
 */
export function useSession() {
  return useQuery<SessionState>({
    queryKey: SESSION_KEY,
    queryFn: () => window.pb.session.current(),
  });
}

/**
 * Keeps the renderer in step with the session. Mount once, at the top of the
 * app. On `session.changed` (sign-in, lock, switch, role change) every other
 * cached query is dropped so nothing from the previous user lingers, and the
 * session itself is refetched in place so screens don't flash or unmount.
 */
export function useSessionSync(): void {
  const client = useQueryClient();
  usePbEvent('session.changed', () => {
    void client.resetQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
    void client.invalidateQueries({ queryKey: SESSION_KEY });
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
