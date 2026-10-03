import { HOUR_MS, SECOND_MS } from '../clock';

export const SCHEDULER_TICK_MS = 15 * SECOND_MS;
export const ERROR_THRESHOLD = 10;
const MAX_JITTER = 0.1;
const FAILURE_BASE_SEC = 60;
const FAILURE_CAP_MS = 6 * HOUR_MS;

/**
 * Delay until the next run after a successful sync: the interval plus 0 to 10% jitter.
 *
 * @param intervalSec - Configured interval.
 * @param random - A value in [0, 1).
 * @returns Delay in milliseconds.
 */
export function successDelayMs(intervalSec: number, random: number): number {
  return Math.round(intervalSec * SECOND_MS * (1 + random * MAX_JITTER));
}

/**
 * Delay until the next run after a failure:
 * `min(intervalSec, 60s * 2^previousFailures)`, capped at 6 hours.
 *
 * @param intervalSec - Configured interval.
 * @param previousFailures - Consecutive failures before this one.
 * @returns Delay in milliseconds.
 */
export function failureDelayMs(intervalSec: number, previousFailures: number): number {
  const backoffMs = FAILURE_BASE_SEC * SECOND_MS * 2 ** previousFailures;
  return Math.min(intervalSec * SECOND_MS, backoffMs, FAILURE_CAP_MS);
}

/**
 * State after a failure: `error` once the threshold is reached, else back to `idle`.
 *
 * @param failures - Consecutive failures including this one.
 * @returns The new sync state.
 */
export function stateAfterFailure(failures: number): 'idle' | 'error' {
  return failures >= ERROR_THRESHOLD ? 'error' : 'idle';
}
