import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const CALLBACK_PATH = '/callback';

export interface Loopback {
  server: Server;
  port: number;
}

export class OAuthCancelledError extends Error {
  override readonly name = 'OAuthCancelledError';

  constructor(message = 'Sign-in was cancelled') {
    super(message);
  }
}

const PAGE = (title: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Photo Beaver</title></head>` +
  `<body style="font-family:system-ui;padding:3rem"><h1>${title}</h1>` +
  `<p>You can close this tab and return to Photo Beaver.</p></body></html>`;

function listenOn(host: string, port: number): Promise<Loopback> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : port });
    });
  });
}

/**
 * Starts the redirect listener on the loopback host, trying fixed ports in order
 * (for providers that need an exact registered redirect URI) or a random port.
 *
 * @param host - 127.0.0.1 or localhost.
 * @param ports - Ports to try; empty for a random port.
 * @returns The listening server and its port.
 * @throws Error when every fixed port is busy.
 */
export async function startLoopback(host: string, ports: readonly number[]): Promise<Loopback> {
  if (ports.length === 0) return listenOn(host, 0);
  for (const port of ports) {
    const started = await listenOn(host, port).catch(() => null);
    if (started) return started;
  }
  throw new Error(`Ports ${ports.join(', ')} are all in use. Close the app using them and retry.`);
}

function callbackResult(req: IncomingMessage, state: string): { code?: string; error?: string } {
  const url = new URL(req.url ?? '/', 'http://loopback');
  if (url.pathname !== CALLBACK_PATH) return {};
  if (url.searchParams.get('state') !== state)
    return { error: 'The sign-in response did not match' };
  const error = url.searchParams.get('error');
  if (error) return { error: url.searchParams.get('error_description') ?? error };
  const code = url.searchParams.get('code');
  return code ? { code } : { error: 'The provider did not return an authorization code' };
}

function respond(res: ServerResponse, ok: boolean): void {
  res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE(ok ? 'Signed in' : 'Sign-in failed'));
}

/**
 * Waits for the provider to redirect back with `code` and the expected `state`.
 * Requests to other paths are ignored (browsers ask for /favicon.ico).
 *
 * @param server - The loopback server.
 * @param state - Expected state.
 * @param signal - Aborts the wait.
 * @param timeoutMs - Gives up after this long.
 * @returns The authorization code.
 */
export function waitForCode(
  server: Server,
  state: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => (
      clearTimeout(timer),
      signal.removeEventListener('abort', onAbort),
      fn()
    );
    const onAbort = () => finish(() => reject(new OAuthCancelledError()));
    const timer = setTimeout(
      () => finish(() => reject(new OAuthCancelledError('Sign-in timed out'))),
      timeoutMs,
    );
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    server.on('request', (req, res) => {
      const result = callbackResult(req, state);
      if (!result.code && !result.error) return void res.writeHead(404).end();
      respond(res, Boolean(result.code));
      finish(() => (result.code ? resolve(result.code) : reject(new Error(result.error))));
    });
  });
}
