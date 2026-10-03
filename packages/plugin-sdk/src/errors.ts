/**
 * Thrown by a connector when the user must reconnect the source.
 */
export class AuthRequiredError extends Error {
  override readonly name = 'AuthRequiredError';

  constructor(message = 'Authorization required') {
    super(message);
  }
}

/**
 * Thrown by a connector to reschedule without counting a failure.
 */
export class RateLimitedError extends Error {
  override readonly name = 'RateLimitedError';
  readonly retryAfterSec: number;

  constructor(options: { retryAfterSec: number; message?: string }) {
    super(options.message ?? `Rate limited, retry after ${options.retryAfterSec}s`);
    this.retryAfterSec = options.retryAfterSec;
  }
}

/**
 * Checks for AuthRequiredError by name so it survives module duplication.
 *
 * @param error - Any thrown value.
 * @returns True for AuthRequiredError.
 */
export function isAuthRequiredError(error: unknown): error is AuthRequiredError {
  return error instanceof Error && error.name === 'AuthRequiredError';
}

/**
 * Checks for RateLimitedError by name so it survives module duplication.
 *
 * @param error - Any thrown value.
 * @returns True for RateLimitedError.
 */
export function isRateLimitedError(error: unknown): error is RateLimitedError {
  return (
    error instanceof Error &&
    error.name === 'RateLimitedError' &&
    typeof (error as RateLimitedError).retryAfterSec === 'number'
  );
}
