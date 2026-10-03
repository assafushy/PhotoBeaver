import type { PbEventName, PbEvents } from '@photobeaver/shared';
import { useEffect, useRef } from 'react';

/**
 * Subscribes to a core push event for the component's lifetime.
 *
 * @param name - Event channel.
 * @param listener - Called with each payload; the latest closure is always used.
 */
export function usePbEvent<K extends PbEventName>(
  name: K,
  listener: (payload: PbEvents[K]) => void,
): void {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => window.pb.events.on(name, (payload) => latest.current(payload)), [name]);
}
