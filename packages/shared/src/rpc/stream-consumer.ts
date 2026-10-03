import { RPC_ERROR_CODES, RpcError } from './errors';

type Waiter = () => void;

/**
 * Receiving end of a remote stream. Items arrive one at a time; the producer
 * sends the next only after `ack` (credit of one), so a slow consumer applies
 * backpressure all the way to the remote iterator.
 */
export class StreamConsumer {
  private readonly items: unknown[] = [];
  private finished = false;
  private failure: Error | null = null;
  private waiter: Waiter | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ack: () => void,
    private readonly cancel: () => void,
    private readonly inactivityMs?: number,
  ) {}

  push(value: unknown): void {
    this.items.push(value);
    this.wake();
  }

  end(): void {
    this.finished = true;
    this.wake();
  }

  fail(error: Error): void {
    this.failure = error;
    this.wake();
  }

  /**
   * Yields items as they arrive; acknowledges each one when the caller asks for
   * the next, and cancels the remote stream if the caller stops early.
   */
  async *iterate(): AsyncGenerator<unknown> {
    let completed = false;
    try {
      for (;;) {
        const item = await this.nextItem();
        if (item.done) break;
        yield item.value;
        this.ack();
      }
      completed = true;
    } finally {
      this.clearTimer();
      if (!completed && !this.finished && !this.failure) this.cancel();
    }
  }

  private async nextItem(): Promise<{ done: true } | { done: false; value: unknown }> {
    while (this.items.length === 0 && !this.finished && !this.failure) await this.waitForSignal();
    if (this.items.length > 0) return { done: false, value: this.items.shift() };
    if (this.failure) throw this.failure;
    return { done: true };
  }

  private waitForSignal(): Promise<void> {
    return new Promise((resolve) => {
      this.waiter = resolve;
      this.armTimer();
    });
  }

  private armTimer(): void {
    if (!this.inactivityMs) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.fail(
        new RpcError({
          code: RPC_ERROR_CODES.timeout,
          message: 'Stream timed out waiting for data',
        }),
      );
      this.cancel();
    }, this.inactivityMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private wake(): void {
    this.clearTimer();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }
}
