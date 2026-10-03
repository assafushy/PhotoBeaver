import { rmSync } from 'node:fs';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { parseDevRequest, type DevRequest, type DevResponse } from '@photobeaver/shared/dev-socket';
import type { CoreLog } from '../connectors/registry';

export type DevRequestHandler = (request: DevRequest) => Promise<string>;

async function answer(line: string, handler: DevRequestHandler): Promise<DevResponse> {
  const parsed = parseDevRequest(line);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  try {
    return { ok: true, pluginId: await handler(parsed.request) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function serve(socket: net.Socket, handler: DevRequestHandler): void {
  const lines = createInterface({ input: socket });
  lines.on(
    'line',
    (line) =>
      void answer(line, handler).then((response) => socket.write(`${JSON.stringify(response)}\n`)),
  );
  socket.on('error', () => socket.destroy());
}

/**
 * The local dev socket `pb-plugin dev` uses to load and hot-reload unpacked
 * plugins (SPEC 5.5). Runs only while developer mode is on. It is a per-user
 * Unix socket (or named pipe), so only the signed-in OS user can reach it.
 */
export class DevSocketServer {
  private server: net.Server | null = null;

  constructor(
    private readonly socketPath: string,
    private readonly handler: DevRequestHandler,
    private readonly logger: CoreLog,
  ) {}

  get listening(): boolean {
    return this.server !== null;
  }

  /** Starts listening; replaces a stale socket file from a previous run. */
  async start(): Promise<void> {
    if (this.server) return;
    if (process.platform !== 'win32') rmSync(this.socketPath, { force: true });
    const server = net.createServer((socket) => serve(socket, this.handler));
    await new Promise<void>((resolve, reject) =>
      server.once('error', reject).listen(this.socketPath, () => resolve()),
    );
    server.on('error', (error) => this.logger.warn({ err: error }, 'Dev socket error'));
    this.server = server;
    this.logger.info({ socket: this.socketPath }, 'Developer socket listening');
  }

  /** Stops listening. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
