import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePbEvent } from '../lib/use-pb-event';

const CAPABILITIES_KEY = ['capabilities'] as const;

/**
 * Which optional screens have a plugin behind them (faces, merging). Works for
 * every role, unlike the plugin list, and refreshes on `plugins.changed`.
 *
 * @returns The capabilities, all false until loaded.
 */
export function useCapabilities(): { faces: boolean; merge: boolean } {
  const client = useQueryClient();
  usePbEvent(
    'plugins.changed',
    () => void client.invalidateQueries({ queryKey: CAPABILITIES_KEY }),
  );
  const { data } = useQuery({
    queryKey: CAPABILITIES_KEY,
    queryFn: () => window.pb.app.capabilities(),
  });
  return data ?? { faces: false, merge: false };
}
