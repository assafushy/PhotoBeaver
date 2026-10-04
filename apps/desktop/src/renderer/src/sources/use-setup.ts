import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';

const isCancelled = (error: Error | null) => error?.message === 'Setup was cancelled';

/**
 * A source setup (add or reconnect) the user can cancel while it waits, for
 * example for a browser sign-in. A cancelled setup is not shown as an error.
 *
 * @param run - Starts the setup with a fresh setup id.
 * @param onSuccess - Called when setup finishes.
 * @returns The mutation, a cancel function and the error to show (if any).
 */
export function useCancellableSetup<TInput, TResult>(
  run: (input: TInput, setupId: string) => Promise<TResult>,
  onSuccess: (result: TResult) => void,
) {
  const setupId = useRef('');
  const mutation = useMutation({
    mutationFn: (input: TInput) => {
      setupId.current = crypto.randomUUID();
      return run(input, setupId.current);
    },
    onSuccess,
  });
  const cancel = () => void window.pb.sources.cancelSetup(setupId.current);
  const error = isCancelled(mutation.error) ? null : mutation.error;
  return { mutation, cancel, error };
}
