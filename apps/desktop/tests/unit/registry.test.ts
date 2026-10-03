import type { IpcChannel, SessionUser } from '@photobeaver/shared';
import { describe, expect, it, vi } from 'vitest';
import { IpcRegistry } from '../../src/main/ipc/registry';
import { FakeTransport, silentLogger, userWithRole } from './helpers';

const EMPTY_PAGE = { items: [], nextCursor: null, total: 0 };

function setup(user: SessionUser) {
  const transport = new FakeTransport();
  const registry = new IpcRegistry(transport, () => user, silentLogger);
  return { transport, registry };
}

describe('IpcRegistry', () => {
  it('runs the handler with parsed input when permitted', async () => {
    const { transport, registry } = setup(userWithRole('viewer'));
    const handler = vi.fn(() => EMPTY_PAGE);
    registry.handle('library.query', handler);
    const result = await transport.invoke('library.query', { limit: 10 });
    expect(result).toEqual({ ok: true, value: EMPTY_PAGE });
    expect(handler).toHaveBeenCalledWith({ cursor: null, limit: 10 }, expect.anything());
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

  it('refuses unknown and duplicate channels', () => {
    const { registry } = setup(userWithRole('admin'));
    expect(() => registry.handle('nope' as IpcChannel, () => EMPTY_PAGE as never)).toThrow(
      /Unknown/,
    );
    registry.handle('session.current', (_i, ctx) => ctx.user);
    expect(() => registry.handle('session.current', (_i, ctx) => ctx.user)).toThrow(/already/);
  });

  it('reports channels that have no handler', () => {
    const { registry } = setup(userWithRole('admin'));
    registry.handle('session.current', (_i, ctx) => ctx.user);
    expect(() => registry.assertComplete()).toThrow(/app\.info, library\.query, assets\.get/);
  });
});
