import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DevSocketServer } from '../../src/main/core/plugins/dev-socket-server';
import { silentCoreLog } from './helpers';

const socketPath =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\pb-dev-test-${process.pid}`
    : path.join(tmpdir(), `pb-dev-test-${process.pid}.sock`);

function ask(line: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath, () => socket.write(`${line}\n`));
    socket.once('data', (data) => (resolve(JSON.parse(data.toString())), socket.end()));
    socket.once('error', reject);
  });
}

describe('DevSocketServer', () => {
  let server: DevSocketServer;

  afterEach(() => server.stop());

  it('answers load and reload requests through the handler', async () => {
    const seen: string[] = [];
    server = new DevSocketServer(
      socketPath,
      async (req) => (seen.push(`${req.cmd}:${req.path}`), 'com.example.x'),
      silentCoreLog,
    );
    await server.start();
    expect(await ask('{"cmd":"load","path":"/p"}')).toEqual({
      ok: true,
      pluginId: 'com.example.x',
    });
    expect(seen).toEqual(['load:/p']);
  });

  it('reports invalid requests and handler errors', async () => {
    server = new DevSocketServer(
      socketPath,
      async () => {
        throw new Error('Invalid manifest');
      },
      silentCoreLog,
    );
    await server.start();
    expect(await ask('{"cmd":"delete","path":"/"}')).toEqual({
      ok: false,
      error: 'Invalid request',
    });
    expect(await ask('{"cmd":"reload","path":"/p"}')).toEqual({
      ok: false,
      error: 'Invalid manifest',
    });
  });
});
