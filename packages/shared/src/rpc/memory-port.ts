import type { RpcMessage, RpcPort } from './types';

/**
 * Two connected in-memory ports, for tests and in-process wiring. Messages are
 * delivered asynchronously and structured-cloned, like a real MessagePort.
 *
 * @returns Both ends.
 */
export function createMemoryPortPair(): [RpcPort, RpcPort] {
  const listeners: [((m: RpcMessage) => void)[], ((m: RpcMessage) => void)[]] = [[], []];
  const closers: [(() => void)[], (() => void)[]] = [[], []];
  let open = true;
  const end = (self: 0 | 1): RpcPort => {
    const other = self === 0 ? 1 : 0;
    return {
      postMessage: (message) => {
        if (!open) throw new Error('Port closed');
        const copy = structuredClone(message);
        setImmediate(() => open && listeners[other].forEach((l) => l(copy)));
      },
      onMessage: (listener) => void listeners[self].push(listener),
      onClose: (listener) => void closers[self].push(listener),
      close: () => {
        if (!open) return;
        open = false;
        setImmediate(() => closers.flat().forEach((l) => l()));
      },
    };
  };
  return [end(0), end(1)];
}
