export class SetupCancelledError extends Error {
  override readonly name = 'SetupCancelledError';

  constructor() {
    super('Setup was cancelled');
  }
}

/**
 * Settles with the promise, or rejects as soon as the signal aborts, so a
 * cancelled setup returns at once even if the connector ignores its signal.
 *
 * @param promise - The work.
 * @param signal - Cancellation.
 * @returns The promise's value.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new SetupCancelledError());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Setups in progress (adding or reconnecting a source), by the id the UI chose,
 * so the UI can cancel one that waits for a browser sign-in.
 */
export class SetupRuns {
  private readonly running = new Map<string, AbortController>();

  /**
   * Registers a setup.
   *
   * @param setupId - Id from the UI, or undefined when it can't be cancelled.
   * @returns The setup's abort signal.
   */
  begin(setupId: string | undefined): AbortSignal {
    const controller = new AbortController();
    if (setupId !== undefined) this.running.set(setupId, controller);
    return controller.signal;
  }

  /**
   * Forgets a finished setup.
   *
   * @param setupId - Setup id.
   */
  end(setupId: string | undefined): void {
    if (setupId !== undefined) this.running.delete(setupId);
  }

  /**
   * Cancels a running setup. Unknown ids are ignored (it already finished).
   *
   * @param setupId - Setup id.
   */
  cancel(setupId: string): void {
    this.running.get(setupId)?.abort();
    this.running.delete(setupId);
  }
}
