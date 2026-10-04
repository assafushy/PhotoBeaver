import { RPC_ERROR_CODES, RpcClosedError, RpcError, toErrorObject } from './errors';
import { StreamConsumer } from './stream-consumer';
import { StreamProducer } from './stream-producer';
import {
  RPC_METHODS,
  type CallOptions,
  type NotificationHandler,
  type ParamsValidator,
  type RequestHandler,
  type RpcErrorObject,
  type RpcId,
  type RpcMessage,
  type RpcPort,
  type StreamHandler,
  type StreamOptions,
} from './types';

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  dispose(): void;
}

type Registered<T> = { fn: T; validate?: ParamsValidator };

const identity: ParamsValidator = (params) => params;

/**
 * A JSON-RPC 2.0 peer (SPEC 6.5): requests with ids, notifications, `$/cancel`,
 * timeouts, and async-iterable streams with one-item credit backpressure.
 * Both core and plugin host use it, each with its own handlers.
 */
export class RpcPeer {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<RpcId, PendingCall>();
  private readonly consumers = new Map<RpcId, StreamConsumer>();
  private readonly producers = new Map<RpcId, StreamProducer>();
  private readonly running = new Map<RpcId, AbortController>();
  private readonly requests = new Map<string, Registered<RequestHandler>>();
  private readonly streams = new Map<string, Registered<StreamHandler>>();
  private readonly notifications = new Map<string, Registered<NotificationHandler>>();
  private readonly closeListeners = new Set<() => void>();

  constructor(private readonly port: RpcPort) {
    port.onMessage((message) => this.dispatch(message));
    port.onClose(() => this.shutdown());
  }

  /** Registers a request handler; `validate` parses params or throws. */
  handle(method: string, fn: RequestHandler, validate?: ParamsValidator): void {
    this.requests.set(method, { fn, validate });
  }

  /** Registers a handler whose result is streamed item by item. */
  handleStream(method: string, fn: StreamHandler, validate?: ParamsValidator): void {
    this.streams.set(method, { fn, validate });
  }

  /** Registers a notification handler; invalid params are dropped. */
  onNotification(method: string, fn: NotificationHandler, validate?: ParamsValidator): void {
    this.notifications.set(method, { fn, validate });
  }

  /** Called once when the connection closes for any reason. */
  onClose(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Calls a remote method.
   *
   * @param method - Method name.
   * @param params - JSON-serializable params.
   * @param options - Cancellation signal and timeout.
   * @returns The remote result.
   */
  request<T = unknown>(method: string, params?: unknown, options: CallOptions = {}): Promise<T> {
    if (this.closed) return Promise.reject(new RpcClosedError());
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const dispose = this.watchCall(id, options, reject);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, dispose });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /**
   * Calls a remote streaming method.
   *
   * @param method - Method name.
   * @param params - JSON-serializable params.
   * @param options - Cancellation signal and inactivity timeout.
   * @returns The remote items, pulled one at a time.
   */
  stream<T = unknown>(
    method: string,
    params?: unknown,
    options: StreamOptions = {},
  ): AsyncIterable<T> {
    if (this.closed) throw new RpcClosedError();
    const id = this.nextId++;
    const consumer = new StreamConsumer(
      () => this.notify(RPC_METHODS.streamAck, { id }),
      () => this.cancelStream(id),
      options.inactivityMs,
    );
    this.consumers.set(id, consumer);
    options.signal?.addEventListener(
      'abort',
      () => (consumer.fail(abortError()), this.cancelStream(id)),
      { once: true },
    );
    this.send({ jsonrpc: '2.0', id, method, params });
    return consumer.iterate() as AsyncIterable<T>;
  }

  /** Sends a notification (no response). */
  notify(method: string, params?: unknown): void {
    if (!this.closed) this.send({ jsonrpc: '2.0', method, params });
  }

  /** Closes the connection and fails everything pending. */
  close(): void {
    if (this.closed) return;
    this.port.close();
    this.shutdown();
  }

  private watchCall(id: RpcId, options: CallOptions, reject: (e: Error) => void): () => void {
    const onAbort = () => (
      this.settle(id),
      reject(abortError()),
      this.notify(RPC_METHODS.cancel, { id })
    );
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = options.timeoutMs
      ? setTimeout(
          () => (this.settle(id), reject(timeoutError()), this.notify(RPC_METHODS.cancel, { id })),
          options.timeoutMs,
        )
      : null;
    return () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
  }

  private settle(id: RpcId): PendingCall | undefined {
    const call = this.pending.get(id);
    this.pending.delete(id);
    call?.dispose();
    return call;
  }

  private cancelStream(id: RpcId): void {
    if (this.consumers.delete(id)) this.notify(RPC_METHODS.cancel, { id });
  }

  private send(message: RpcMessage): void {
    try {
      this.port.postMessage(message);
    } catch {
      this.shutdown();
    }
  }

  private dispatch(message: RpcMessage): void {
    if ('id' in message && 'method' in message)
      return void this.onRequest(message.id, message.method, message.params);
    if ('id' in message) return this.onResponse(message);
    this.onNotify(message.method, message.params);
  }

  private onResponse(message: Extract<RpcMessage, { id: RpcId }>): void {
    const call = this.settle(message.id);
    if (!call && 'error' in message)
      return this.finishConsumer(message.id, new RpcError(message.error));
    if (!call) return;
    if ('error' in message) call.reject(new RpcError(message.error));
    else if ('result' in message) call.resolve(message.result);
  }

  private onNotify(method: string, params: unknown): void {
    const { id } = (params ?? {}) as { id?: RpcId };
    if (method === RPC_METHODS.streamNext)
      return this.consumers.get(id!)?.push((params as { value: unknown }).value);
    if (method === RPC_METHODS.streamEnd) return this.finishConsumer(id!, null);
    if (method === RPC_METHODS.streamError)
      return this.finishConsumer(id!, new RpcError((params as { error: RpcErrorObject }).error));
    if (method === RPC_METHODS.streamAck) return this.producers.get(id!)?.acknowledge();
    if (method === RPC_METHODS.cancel) return this.cancelInbound(id!);
    this.runNotification(method, params);
  }

  private runNotification(method: string, params: unknown): void {
    const handler = this.notifications.get(method);
    if (!handler) return;
    try {
      handler.fn((handler.validate ?? identity)(params));
    } catch {
      return;
    }
  }

  private finishConsumer(id: RpcId, error: Error | null): void {
    const consumer = this.consumers.get(id);
    this.consumers.delete(id);
    if (error) consumer?.fail(error);
    else consumer?.end();
  }

  private cancelInbound(id: RpcId): void {
    this.running.get(id)?.abort();
    this.producers.get(id)?.cancel();
  }

  private async onRequest(id: RpcId, method: string, params: unknown): Promise<void> {
    const stream = this.streams.get(method);
    if (stream) return this.runStream(id, stream, params);
    const handler = this.requests.get(method);
    if (!handler)
      return this.reply(id, {
        code: RPC_ERROR_CODES.methodNotFound,
        message: `Unknown method: ${method}`,
      });
    const parsed = this.parse(handler, params);
    if (parsed.error) return this.reply(id, parsed.error);
    await this.runRequest(id, handler.fn, parsed.value);
  }

  private parse(
    handler: Registered<unknown>,
    params: unknown,
  ): { value?: unknown; error?: RpcErrorObject } {
    try {
      return { value: (handler.validate ?? identity)(params) };
    } catch (error) {
      return { error: toErrorObject(error, RPC_ERROR_CODES.invalidParams) };
    }
  }

  private async runRequest(id: RpcId, fn: RequestHandler, params: unknown): Promise<void> {
    const abort = new AbortController();
    this.running.set(id, abort);
    try {
      const result = await fn(params, { signal: abort.signal });
      if (!abort.signal.aborted) this.send({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (error) {
      if (!abort.signal.aborted) this.reply(id, toErrorObject(error));
    } finally {
      this.running.delete(id);
    }
  }

  private async runStream(
    id: RpcId,
    handler: Registered<StreamHandler>,
    params: unknown,
  ): Promise<void> {
    const parsed = this.parse(handler, params);
    if (parsed.error) return this.notify(RPC_METHODS.streamError, { id, error: parsed.error });
    const abort = new AbortController();
    const producer = new StreamProducer(
      handler.fn(parsed.value, { signal: abort.signal }),
      this.streamSender(id),
      abort,
    );
    this.producers.set(id, producer);
    try {
      await producer.run();
    } finally {
      this.producers.delete(id);
    }
  }

  private streamSender(id: RpcId) {
    return {
      next: (value: unknown) => this.notify(RPC_METHODS.streamNext, { id, value }),
      end: () => this.notify(RPC_METHODS.streamEnd, { id }),
      error: (error: unknown) =>
        this.notify(RPC_METHODS.streamError, { id, error: toErrorObject(error) }),
    };
  }

  private reply(id: RpcId, error: RpcErrorObject): void {
    this.send({ jsonrpc: '2.0', id, error });
  }

  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(new RpcClosedError());
    for (const consumer of this.consumers.values()) consumer.fail(new RpcClosedError());
    this.consumers.clear();
    this.running.forEach((abort) => abort.abort());
    this.producers.forEach((producer) => producer.cancel());
    this.closeListeners.forEach((listener) => listener());
  }
}

function abortError(): Error {
  return new RpcError({
    code: RPC_ERROR_CODES.cancelled,
    message: 'Cancelled',
    data: { name: 'AbortError' },
  });
}

function timeoutError(): Error {
  return new RpcError({
    code: RPC_ERROR_CODES.timeout,
    message: 'RPC call timed out',
    data: { name: 'RpcTimeoutError' },
  });
}
