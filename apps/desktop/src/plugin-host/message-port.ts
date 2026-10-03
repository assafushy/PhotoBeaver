import type { RpcMessage, RpcPort } from '@photobeaver/shared/rpc';

export interface MessagePortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  on(event: 'close', listener: () => void): void;
  start(): void;
  close(): void;
}

/**
 * Adapts Electron's MessagePortMain (both in main and in a utilityProcess) to RpcPort.
 *
 * @param port - The message port.
 * @returns The RPC transport.
 */
export function messagePortTransport(port: MessagePortLike): RpcPort {
  const transport: RpcPort = {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', (event) => listener(event.data as RpcMessage)),
    onClose: (listener) => port.on('close', listener),
    close: () => port.close(),
  };
  port.start();
  return transport;
}
