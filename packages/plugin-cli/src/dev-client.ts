import { createConnection, type Socket } from 'node:net';
import { devSocketPath, type DevRequest, type DevResponse } from '@photobeaver/shared/dev-socket';

const NOT_LISTENING_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE']);
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Whether a socket error means no Photo Beaver is listening.
 *
 * @param error - Error from the connection.
 * @returns True for "no listener" errors.
 */
export function isNotListening(error: unknown): boolean {
  return NOT_LISTENING_CODES.has((error as NodeJS.ErrnoException).code ?? '');
}

function parseResponse(line: string): DevResponse {
  const parsed = JSON.parse(line) as DevResponse;
  if (typeof parsed?.ok !== 'boolean') throw new Error('Invalid response from Photo Beaver');
  return parsed;
}

function onFirstLine(socket: Socket, handle: (line: string) => void): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline === -1) return;
    socket.end();
    handle(buffer.slice(0, newline));
  });
}

/**
 * Sends one request to the dev socket and waits for its one-line JSON reply.
 *
 * @param request - load or reload with the absolute plugin folder.
 * @param socketPath - Socket path or pipe name.
 * @param timeoutMs - How long to wait for a reply.
 * @returns The response.
 */
export function sendDevRequest(
  request: DevRequest,
  socketPath = devSocketPath(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DevResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath, () => socket.write(`${JSON.stringify(request)}\n`));
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Photo Beaver did not respond')));
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('Photo Beaver closed the connection')));
    onFirstLine(socket, (line) => {
      try {
        resolve(parseResponse(line));
      } catch (error) {
        reject(error);
      }
    });
  });
}
