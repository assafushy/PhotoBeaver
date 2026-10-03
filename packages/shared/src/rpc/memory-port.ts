import type { RpcMessage, RpcPort } from './types';

type Listener = (m: RpcMessage) => void;

interface PairState {
  listeners: [Listener[], Listener[]];
  closers: [(() => void)[], (() => void)[]];
  open: boolean;
}

function closePair(state: PairState): void {
  if (!state.open) return;
  state.open = false;
  setImmediate(() => state.closers.flat().forEach((l) => l()));
}

function memoryEnd(state: PairState, self: 0 | 1): RpcPort {
  const other = self === 0 ? 1 : 0;
  return {
    postMessage: (message) => {
      if (!state.open) throw new Error('Port closed');
      const copy = structuredClone(message);
      setImmediate(() => state.open && state.listeners[other].forEach((l) => l(copy)));
    },
    onMessage: (listener) => void state.listeners[self].push(listener),
    onClose: (listener) => void state.closers[self].push(listener),
    close: () => closePair(state),
  };
}

/**
 * Two connected in-memory ports, for tests and in-process wiring. Messages are
 * delivered asynchronously and structured-cloned, like a real MessagePort.
 *
 * @returns Both ends.
 */
export function createMemoryPortPair(): [RpcPort, RpcPort] {
  const state: PairState = { listeners: [[], []], closers: [[], []], open: true };
  return [memoryEnd(state, 0), memoryEnd(state, 1)];
}
