import { describe, expect, it } from 'vitest';
import {
  AuthRequiredError,
  RateLimitedError,
  isAuthRequiredError,
  isRateLimitedError,
} from '../src';

describe('sdk errors', () => {
  it('recognizes AuthRequiredError', () => {
    expect(isAuthRequiredError(new AuthRequiredError())).toBe(true);
    expect(isAuthRequiredError(new Error('x'))).toBe(false);
  });

  it('carries retryAfterSec on RateLimitedError', () => {
    const error = new RateLimitedError({ retryAfterSec: 30 });
    expect(isRateLimitedError(error)).toBe(true);
    expect(error.retryAfterSec).toBe(30);
  });

  it('recognizes errors recreated by name', () => {
    const copy = Object.assign(new Error('x'), { name: 'RateLimitedError', retryAfterSec: 5 });
    expect(isRateLimitedError(copy)).toBe(true);
  });
});
