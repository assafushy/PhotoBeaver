import { MINUTE_MS, SECOND_MS } from '../clock';

export const RESTART_BACKOFF_MS = [
  SECOND_MS,
  5 * SECOND_MS,
  30 * SECOND_MS,
  2 * MINUTE_MS,
] as const;
export const CRASH_LIMIT = 5;
export const CRASH_WINDOW_MS = 10 * MINUTE_MS;

/**
 * Tracks host crashes (SPEC 7.6): restart backoff of 1s, 5s, 30s, 2m, and a
 * "crashed" verdict after 5 crashes within 10 minutes.
 */
export class CrashPolicy {
  private crashes: number[] = [];

  /**
   * Records a crash.
   *
   * @param now - Current time.
   * @returns Delay before the next start, or null when the plugin must stop (crashed).
   */
  record(now: number): number | null {
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (this.crashes.length >= CRASH_LIMIT) return null;
    return RESTART_BACKOFF_MS[Math.min(this.crashes.length - 1, RESTART_BACKOFF_MS.length - 1)]!;
  }

  /** Number of crashes inside the current window. */
  get recentCrashes(): number {
    return this.crashes.length;
  }

  /** Forgets history ("Re-enable"). */
  reset(): void {
    this.crashes = [];
  }
}
