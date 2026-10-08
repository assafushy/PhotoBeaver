import { useQuery } from '@tanstack/react-query';

export const USERS_SETTINGS_KEY = ['users', 'settings'] as const;

/**
 * Multiple users on or off, the auto-lock time and whether Touch ID exists here.
 *
 * @returns The users settings query.
 */
export function useUsersSettings() {
  return useQuery({ queryKey: USERS_SETTINGS_KEY, queryFn: () => window.pb.users.settings() });
}
