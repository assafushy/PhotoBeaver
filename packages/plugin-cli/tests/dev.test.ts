import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DevRequest } from '@photobeaver/shared/dev-socket';
import { createDevNotifier, isNotListening, NOT_LISTENING_MESSAGE, sendDevRequest } from '../src';
import { cleanupTemp, recordingOutput, tempProject } from './helpers';

const BUILT = { ok: true as const, outfile: '/p/dist/index.js' };
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
  cleanupTemp();
});

function socketPath(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\pb-cli-test-${process.pid}-${Date.now()}`;
  return path.join(tempProject(), 'dev.sock');
}

function listen(file: string, reply: (request: DevRequest) => object): Promise<void> {
  server = createServer((socket) => {
    socket.on('data', (data) => socket.end(`${JSON.stringify(reply(JSON.parse(String(data))))}\n`));
  });
  return new Promise((resolve) => server!.listen(file, resolve));
}

describe('createDevNotifier', () => {
  it('loads once, then reloads after each build', async () => {
    const sent: DevRequest[] = [];
    const out = recordingOutput();
    const notify = createDevNotifier('/p', out, async (request) => {
      sent.push(request);
      return { ok: true, pluginId: 'com.example.p' };
    });
    await notify(BUILT);
    await notify({ ok: false, errors: ['oops'] });
    await notify(BUILT);
    expect(sent.map((r) => r.cmd)).toEqual(['load', 'reload']);
    expect(out.lines).toContain('Photo Beaver: reloaded com.example.p');
    expect(out.errors).toContain('  oops');
  });

  it('prints the hint and retries load when nobody is listening', async () => {
    const sent: string[] = [];
    const out = recordingOutput();
    const notify = createDevNotifier('/p', out, async (request) => {
      sent.push(request.cmd);
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    });
    await notify(BUILT);
    await notify(BUILT);
    expect(sent).toEqual(['load', 'load']);
    expect(out.errors).toEqual([NOT_LISTENING_MESSAGE, NOT_LISTENING_MESSAGE]);
  });
});

describe('sendDevRequest', () => {
  it('sends one JSON line and reads the reply', async () => {
    const file = socketPath();
    await listen(file, (request) => ({ ok: true, pluginId: `${request.cmd}:${request.path}` }));
    expect(await sendDevRequest({ cmd: 'load', path: '/abs' }, file)).toEqual({
      ok: true,
      pluginId: 'load:/abs',
    });
  });

  it('reports a missing socket as not listening', async () => {
    const error = await sendDevRequest({ cmd: 'load', path: '/abs' }, socketPath()).catch(
      (e: unknown) => e,
    );
    expect(isNotListening(error)).toBe(true);
  });
});
