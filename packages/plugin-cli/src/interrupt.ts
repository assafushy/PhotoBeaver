/**
 * Waits for Ctrl+C (SIGINT) or SIGTERM, then runs the cleanup.
 *
 * @param cleanup - Called once before resolving.
 * @returns Exit code 0 once stopped.
 */
export function untilInterrupted(cleanup: () => Promise<void>): Promise<number> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      void cleanup().then(() => resolve(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
