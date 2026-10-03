export type RpcId = number;

export interface RpcErrorObject {
  code: number;
  message: string;
  data?: { name?: string; retryAfterSec?: number };
}

export type RpcMessage =
  | { jsonrpc: '2.0'; id: RpcId; method: string; params?: unknown }
  | { jsonrpc: '2.0'; id: RpcId; result: unknown }
  | { jsonrpc: '2.0'; id: RpcId; error: RpcErrorObject }
  | { jsonrpc: '2.0'; method: string; params?: unknown };

/**
 * The minimum a transport must offer: Electron's MessagePortMain, a
 * worker_threads MessagePort, or an in-memory pair in tests.
 */
export interface RpcPort {
  postMessage(message: RpcMessage): void;
  onMessage(listener: (message: RpcMessage) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StreamOptions {
  signal?: AbortSignal;
  inactivityMs?: number;
}

export interface HandlerContext {
  signal: AbortSignal;
}

export type RequestHandler = (params: unknown, ctx: HandlerContext) => unknown;
export type StreamHandler = (params: unknown, ctx: HandlerContext) => AsyncIterable<unknown>;
export type NotificationHandler = (params: unknown) => void;
export type ParamsValidator = (params: unknown) => unknown;

export const RPC_METHODS = {
  cancel: '$/cancel',
  streamNext: 'stream/next',
  streamEnd: 'stream/end',
  streamError: 'stream/error',
  streamAck: 'stream/ack',
} as const;
