/**
 * Sending end of a stream: pulls the local iterator one item at a time and waits
 * for the remote acknowledgement before pulling the next.
 */
export class StreamProducer {
  private ackWaiter: (() => void) | null = null;

  constructor(
    private readonly iterable: AsyncIterable<unknown>,
    private readonly send: {
      next(value: unknown): void;
      end(): void;
      error(error: unknown): void;
    },
    private readonly abort: AbortController,
  ) {}

  /** Called when the consumer acknowledges an item. */
  acknowledge(): void {
    const waiter = this.ackWaiter;
    this.ackWaiter = null;
    waiter?.();
  }

  /** Stops the stream at the consumer's request. */
  cancel(): void {
    this.abort.abort();
    this.acknowledge();
  }

  /**
   * Runs the stream to completion, error or cancellation.
   *
   * @returns Resolves when the stream has ended.
   */
  async run(): Promise<void> {
    const iterator = this.iterable[Symbol.asyncIterator]();
    try {
      await this.pump(iterator);
    } catch (error) {
      if (!this.abort.signal.aborted) this.send.error(error);
    } finally {
      if (this.abort.signal.aborted) await iterator.return?.();
    }
  }

  private async pump(iterator: AsyncIterator<unknown>): Promise<void> {
    for (;;) {
      const step = await iterator.next();
      if (this.abort.signal.aborted) return;
      if (step.done) return this.send.end();
      const acked = new Promise<void>((resolve) => (this.ackWaiter = resolve));
      this.send.next(step.value);
      await acked;
      if (this.abort.signal.aborted) return;
    }
  }
}
