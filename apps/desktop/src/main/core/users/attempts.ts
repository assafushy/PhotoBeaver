export const FREE_ATTEMPTS = 5;
export const PENALTY_MS = 30_000;

/**
 * Slows down guessing: after 5 wrong attempts for a user, each further attempt
 * must wait 30 seconds more. Kept in memory; a restart resets it.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; last: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Throws when the user must wait before trying again.
   *
   * @param key - User id (or "recovery").
   */
  assertAllowed(key: string): void {
    const entry = this.failures.get(key);
    if (!entry || entry.count < FREE_ATTEMPTS) return;
    const waitMs = entry.last + (entry.count - FREE_ATTEMPTS + 1) * PENALTY_MS - this.now();
    if (waitMs > 0)
      throw new Error(`Too many attempts. Try again in ${Math.ceil(waitMs / 1000)} seconds.`);
  }

  failed(key: string): void {
    const count = (this.failures.get(key)?.count ?? 0) + 1;
    this.failures.set(key, { count, last: this.now() });
  }

  succeeded(key: string): void {
    this.failures.delete(key);
  }
}
