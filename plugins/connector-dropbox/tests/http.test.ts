import { describe, expect, it } from 'vitest';
import { isAuthRequiredError, isRateLimitedError } from '@photobeaver/plugin-sdk';
import { runSync } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { contextFor, seededDropbox } from './helpers';

describe('auth and rate limits', () => {
  it('refreshes an expired token once and saves the new one', async () => {
    const fake = seededDropbox();
    const context = contextFor(fake);
    fake.expireToken();
    const result = await runSync(connector, { config: {}, context });
    expect(result.items).toHaveLength(7);
    expect(result.recorded.secret).toMatchObject({
      accessToken: fake.validToken,
      refreshToken: 'refresh-1',
    });
    expect(result.recorded.oauth).toMatchObject([
      { kind: 'refresh', options: { clientId: 'k', refreshToken: 'refresh-1' } },
    ]);
  });

  it('asks to reconnect when the refresh is rejected', async () => {
    const fake = seededDropbox();
    const refresh = async () => Promise.reject(new Error('invalid_grant'));
    const context = contextFor(fake, { oauth: { refresh } });
    fake.expireToken();
    const error = await runSync(connector, { config: {}, context }).catch((e: unknown) => e);
    expect(isAuthRequiredError(error)).toBe(true);
  });

  it('turns a 429 into RateLimitedError with Retry-After', async () => {
    const fake = seededDropbox();
    fake.rateLimitNext(42);
    const error = await runSync(connector, { config: {}, context: contextFor(fake) }).catch(
      (e: unknown) => e,
    );
    expect(isRateLimitedError(error) && error.retryAfterSec).toBe(42);
  });
});
