import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePbEvent } from '../lib/use-pb-event';

export const PLUGINS_QUERY_KEY = ['plugins'] as const;

/**
 * Installed plugins, refreshed on `plugins.changed`.
 *
 * @returns The plugins query.
 */
export function usePlugins() {
  const client = useQueryClient();
  usePbEvent(
    'plugins.changed',
    () => void client.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY }),
  );
  return useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: () => window.pb.plugins.list() });
}

/**
 * Invalidates the plugin list after a change made from this window.
 *
 * @returns A function that refreshes plugins and sources.
 */
export function useRefreshPlugins(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY });
    void client.invalidateQueries({ queryKey: ['sources'] });
    void client.invalidateQueries({ queryKey: ['connectors'] });
  };
}
