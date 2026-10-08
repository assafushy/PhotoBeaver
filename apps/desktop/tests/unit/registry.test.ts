import type { IpcChannel, SessionUser } from '@photobeaver/shared';
import { describe, expect, it, vi } from 'vitest';
import { IpcRegistry } from '../../src/main/ipc/registry';
import { FakeTransport, silentLogger, userWithRole } from './helpers';

const EMPTY_PAGE = { items: [], nextCursor: null, total: 0 };
const APP_INFO = { version: '1', platform: 'test', userDataDir: '/u', libraryDir: '/l' };

function setup(user: SessionUser | null) {
  const transport = new FakeTransport();
  const registry = new IpcRegistry(
    transport,
    { current: () => user, scope: () => null },
    silentLogger,
  );
  return { transport, registry };
}

describe('IpcRegistry', () => {
  it('runs the handler with parsed input when permitted', async () => {
    const { transport, registry } = setup(userWithRole('viewer'));
    const handler = vi.fn(() => EMPTY_PAGE);
    registry.handle('library.query', handler);
    const result = await transport.invoke('library.query', { limit: 10 });
    expect(result).toEqual({ ok: true, value: EMPTY_PAGE });
    expect(handler).toHaveBeenCalledWith(
      { cursor: null, limit: 10, filter: {} },
      expect.anything(),
    );
  });

  it('denies a session that lacks the required permission', async () => {
    const { transport, registry } = setup({ ...userWithRole('viewer'), permissions: [] });
    const handler = vi.fn(() => EMPTY_PAGE);
    registry.handle('library.query', handler);
    const result = await transport.invoke('library.query', {});
    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects invalid input without calling the handler', async () => {
    const { transport, registry } = setup(userWithRole('admin'));
    const handler = vi.fn(() => EMPTY_PAGE);
    registry.handle('library.query', handler);
    const result = await transport.invoke('library.query', { limit: -1 });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('wraps handler exceptions as INTERNAL errors', async () => {
    const { transport, registry } = setup(userWithRole('admin'));
    registry.handle('app.info', () => {
      throw new Error('boom');
    });
    const result = await transport.invoke('app.info');
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'boom' } });
  });

  it('answers LOCKED while nobody is signed in, but serves public channels', async () => {
    const { transport, registry } = setup(null);
    const handler = vi.fn(() => EMPTY_PAGE);
    registry.handle('library.query', handler);
    registry.handle('auth.users', () => []);
    expect(await transport.invoke('library.query', {})).toEqual({
      ok: false,
      error: { code: 'LOCKED', message: 'Sign in to continue' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(await transport.invoke('auth.users')).toEqual({ ok: true, value: [] });
  });

  it('refuses unknown and duplicate channels', () => {
    const { registry } = setup(userWithRole('admin'));
    expect(() => registry.handle('nope' as IpcChannel, () => EMPTY_PAGE as never)).toThrow(
      /Unknown/,
    );
    registry.handle('app.info', () => APP_INFO);
    expect(() => registry.handle('app.info', () => APP_INFO)).toThrow(/already/);
  });

  it('reports channels that have no handler', () => {
    const { registry } = setup(userWithRole('admin'));
    registry.handle('app.info', () => APP_INFO);
    expect(() => registry.assertComplete()).toThrow(/session\.current, auth\.users/);
  });
});
