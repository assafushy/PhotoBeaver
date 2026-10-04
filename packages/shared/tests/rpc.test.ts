import { describe, expect, it } from 'vitest';
import { createMemoryPortPair, isRpcClosedError, RpcPeer } from '../src/rpc';

function pair(): [RpcPeer, RpcPeer] {
  const [a, b] = createMemoryPortPair();
  return [new RpcPeer(a), new RpcPeer(b)];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RpcPeer requests', () => {
  it('returns results and remote errors with their name and fields', async () => {
    const [core, host] = pair();
    host.handle('add', (p) => (p as number[]).reduce((a, b) => a + b, 0));
    host.handle('limited', () => {
      throw Object.assign(new Error('slow down'), { name: 'RateLimitedError', retryAfterSec: 7 });
    });
    expect(await core.request('add', [1, 2, 3])).toBe(6);
    await expect(core.request('limited')).rejects.toMatchObject({
      name: 'RateLimitedError',
      retryAfterSec: 7,
    });
    await expect(core.request('missing')).rejects.toMatchObject({ code: -32601 });
  });

  it('rejects params that fail validation', async () => {
    const [core, host] = pair();
    host.handle(
      'echo',
      (p) => p,
      (p) => {
        if (typeof p !== 'string') throw new Error('expected string');
        return p;
      },
    );
    await expect(core.request('echo', 5)).rejects.toMatchObject({
      code: -32602,
      message: 'expected string',
    });
  });

  it('times out and cancels the remote handler', async () => {
    const [core, host] = pair();
    let aborted = false;
    host.handle(
      'hang',
      (_p, { signal }) =>
        new Promise((r) => signal.addEventListener('abort', () => ((aborted = true), r(null)))),
    );
    await expect(core.request('hang', null, { timeoutMs: 20 })).rejects.toMatchObject({
      name: 'RpcTimeoutError',
    });
    await delay(20);
    expect(aborted).toBe(true);
  });

  it('cancels through an AbortSignal', async () => {
    const [core, host] = pair();
    host.handle('hang', () => new Promise(() => undefined));
    const controller = new AbortController();
    const call = core.request('hang', null, { signal: controller.signal });
    controller.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fails pending calls when the connection closes', async () => {
    const [core, host] = pair();
    host.handle('hang', () => new Promise(() => undefined));
    const call = core.request('hang');
    host.close();
    await expect(call).rejects.toSatisfy(isRpcClosedError);
    await expect(core.request('x')).rejects.toSatisfy(isRpcClosedError);
  });

  it('delivers notifications', async () => {
    const [core, host] = pair();
    const seen: unknown[] = [];
    core.onNotification('log', (p) => seen.push(p));
    host.notify('log', { msg: 'hi' });
    await delay(5);
    expect(seen).toEqual([{ msg: 'hi' }]);
  });
});

describe('RpcPeer streams', () => {
  it('streams items with one-item backpressure', async () => {
    const [core, host] = pair();
    let pulled = 0;
    host.handleStream('count', async function* () {
      for (let i = 0; i < 5; i++) {
        pulled++;
        yield i;
      }
    });
    const seen: number[] = [];
    for await (const value of core.stream<number>('count')) {
      await delay(10);
      expect(pulled).toBeLessThanOrEqual(value + 2);
      seen.push(value);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('carries binary chunks', async () => {
    const [core, host] = pair();
    host.handleStream('bytes', async function* () {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3]);
    });
    const chunks: number[] = [];
    for await (const chunk of core.stream<Uint8Array>('bytes')) chunks.push(...chunk);
    expect(chunks).toEqual([1, 2, 3]);
  });

  it('propagates producer errors and unknown methods', async () => {
    const [core, host] = pair();
    host.handleStream('broken', async function* () {
      yield 1;
      throw Object.assign(new Error('auth'), { name: 'AuthRequiredError' });
    });
    const run = async (method: string) => {
      for await (const item of core.stream(method)) void item;
    };
    await expect(run('broken')).rejects.toMatchObject({ name: 'AuthRequiredError' });
    await expect(run('nope')).rejects.toMatchObject({ code: -32601 });
  });

  it('cancels the remote iterator when the consumer stops early', async () => {
    const [core, host] = pair();
    let cleanedUp = false;
    host.handleStream('endless', async function* () {
      try {
        for (let i = 0; ; i++) yield i;
      } finally {
        cleanedUp = true;
      }
    });
    for await (const value of core.stream<number>('endless')) if (value === 2) break;
    await delay(20);
    expect(cleanedUp).toBe(true);
  });

  it('fails a stream that goes quiet past its inactivity timeout', async () => {
    const [core, host] = pair();
    host.handleStream('stall', async function* () {
      yield 1;
      await new Promise(() => undefined);
    });
    const run = async () => {
      for await (const item of core.stream('stall', null, { inactivityMs: 30 })) void item;
    };
    await expect(run()).rejects.toMatchObject({ code: -32001 });
  });

  it('fails an open stream when the connection closes', async () => {
    const [core, host] = pair();
    host.handleStream('slow', async function* () {
      yield 1;
      await new Promise(() => undefined);
    });
    const run = async () => {
      for await (const item of core.stream('slow')) {
        void item;
        host.close();
      }
    };
    await expect(run()).rejects.toSatisfy(isRpcClosedError);
  });
});
