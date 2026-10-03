import type { RpcErrorObject } from './types';

export const RPC_ERROR_CODES = {
  invalidParams: -32602,
  methodNotFound: -32601,
  internal: -32603,
  cancelled: -32800,
  timeout: -32001,
  closed: -32002,
} as const;

/**
 * An error that crossed the RPC boundary. `name` and extra fields (such as
 * `retryAfterSec`) are restored so callers can recognize SDK errors by name.
 */
export class RpcError extends Error {
  readonly code: number;
  readonly retryAfterSec?: number;

  constructor(error: RpcErrorObject) {
    super(error.message);
    this.code = error.code;
    this.name = error.data?.name ?? 'RpcError';
    if (error.data?.retryAfterSec !== undefined) this.retryAfterSec = error.data.retryAfterSec;
  }
}

/**
 * Raised for every pending call when the port closes (for example, a plugin host crashed).
 */
export class RpcClosedError extends Error {
  override readonly name = 'RpcClosedError';

  constructor(message = 'RPC connection closed') {
    super(message);
  }
}

/**
 * Serializes any thrown value for the wire.
 *
 * @param error - The thrown value.
 * @param code - Error code to use.
 * @returns A JSON-RPC error object.
 */
export function toErrorObject(
  error: unknown,
  code: number = RPC_ERROR_CODES.internal,
): RpcErrorObject {
  if (!(error instanceof Error)) return { code, message: String(error) };
  const { retryAfterSec, code: ownCode } = error as { retryAfterSec?: unknown; code?: unknown };
  const data =
    typeof retryAfterSec === 'number' ? { name: error.name, retryAfterSec } : { name: error.name };
  return { code: typeof ownCode === 'number' ? ownCode : code, message: error.message, data };
}

/**
 * True when an error means the remote side went away.
 *
 * @param error - Any thrown value.
 * @returns Whether it is an RpcClosedError.
 */
export function isRpcClosedError(error: unknown): error is RpcClosedError {
  return error instanceof Error && error.name === 'RpcClosedError';
}
