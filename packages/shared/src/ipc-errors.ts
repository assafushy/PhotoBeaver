export const IPC_ERROR_CODES = [
  'PERMISSION_DENIED',
  'LOCKED',
  'INVALID_INPUT',
  'INTERNAL',
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export interface IpcErrorPayload {
  code: IpcErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcErrorPayload };
