import { messagePortTransport, type MessagePortLike } from './message-port';
import { startHostRuntime } from './runtime';

interface ParentPort {
  once(event: 'message', listener: (event: { ports: MessagePortLike[] }) => void): void;
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

parentPort.once('message', (event) => {
  const port = event.ports[0];
  if (!port) process.exit(1);
  const peer = startHostRuntime(messagePortTransport(port));
  peer.onClose(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in plugin host:', error);
  process.exit(70);
});
