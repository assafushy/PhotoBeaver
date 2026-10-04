import { useEffect, useState } from 'react';

/**
 * Debounces a value.
 *
 * @param value - The live value.
 * @param delayMs - Quiet period before the value is passed on.
 * @returns The value as of the last quiet period.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
