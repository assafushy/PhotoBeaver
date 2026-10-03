const MAX_RETRIES = 3;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

export interface RateLimit {
  requests: number;
  perSec: number;
}

/**
 * Token bucket: `requests` tokens refilled evenly over `perSec` seconds.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly limit: RateLimit) {
    this.tokens = limit.requests;
  }

  /** Waits until a token is available, then takes it. */
  async take(signal?: AbortSignal): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) return void (this.tokens -= 1);
      const waitMs = ((1 - this.tokens) * this.limit.perSec * 1000) / this.limit.requests;
      await sleep(Math.ceil(waitMs), signal);
    }
  }

  private refill(): void {
    const now = Date.now();
    const rate = this.limit.requests / (this.limit.perSec * 1000);
    this.tokens = Math.min(this.limit.requests, this.tokens + (now - this.last) * rate);
    this.last = now;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), {
      once: true,
    });
  });
}

/**
 * Delay requested by a 429 response's Retry-After header (seconds or HTTP date).
 *
 * @param header - Header value or null.
 * @returns Milliseconds to wait.
 */
export function retryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_MS;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Math.min(MAX_RETRY_MS, Math.max(0, Number.isFinite(ms) ? ms : DEFAULT_RETRY_MS));
}

/**
 * Builds `ctx.fetch` (SPEC 6.2): the allowlisted fetch plus the manifest rate
 * limit and automatic retries of 429 responses honoring Retry-After.
 *
 * @param base - The network-guarded fetch.
 * @param limit - Manifest rate limit, if any.
 * @returns A fetch-compatible function.
 */
export function createRateLimitedFetch(base: typeof fetch, limit?: RateLimit): typeof fetch {
  const bucket = limit ? new TokenBucket(limit) : null;
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      await bucket?.take(init?.signal ?? undefined);
      const response = await base(input, init);
      if (response.status !== 429 || attempt >= MAX_RETRIES) return response;
      await sleep(retryAfterMs(response.headers.get('Retry-After')), init?.signal ?? undefined);
    }
  };
}
