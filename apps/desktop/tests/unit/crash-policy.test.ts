import { describe, expect, it } from 'vitest';
import { CrashPolicy, CRASH_WINDOW_MS } from '../../src/main/core/plugins/crash-policy';

describe('CrashPolicy', () => {
  it('restarts with 1s, 5s, 30s, 2m backoff and gives up at the fifth crash', () => {
    const policy = new CrashPolicy();
    expect([0, 1, 2, 3].map((i) => policy.record(i))).toEqual([1000, 5000, 30000, 120000]);
    expect(policy.record(4)).toBeNull();
  });

  it('forgets crashes older than 10 minutes', () => {
    const policy = new CrashPolicy();
    for (let i = 0; i < 4; i++) policy.record(i);
    expect(policy.record(CRASH_WINDOW_MS + 10)).toBe(1000);
    expect(policy.recentCrashes).toBe(1);
  });
});
