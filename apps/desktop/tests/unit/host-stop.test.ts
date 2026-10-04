import { describe, expect, it } from 'vitest';
import { HostHandle } from '../../src/main/core/plugins/host-handle';
import type { LaunchedHost } from '../../src/main/core/plugins/host-launcher';
import { silentCoreLog } from './helpers';
import { testHostInit } from './memory-launcher';

function silentHost(): LaunchedHost & { killed: boolean } {
  const host = {
    killed: false,
    pid: 1,
    port: {
      postMessage: () => undefined,
      onMessage: () => undefined,
      onClose: () => undefined,
      close: () => undefined,
    },
    kill: () => void (host.killed = true),
    onExit: () => undefined,
  };
  return host;
}

describe('HostHandle.stop', () => {
  it('kills a host that is still starting, so quitting leaves no plugin process', async () => {
    const host = silentHost();
    const handle = new HostHandle({
      pluginId: 'p',
      launcher: { launch: () => host },
      launchOptions: { pluginId: 'p', maxOldSpaceMb: 256, logFile: '' },
      init: testHostInit('p'),
      registerCoreHandlers: () => undefined,
      onStarted: () => undefined,
      onCrashed: () => undefined,
      logger: silentCoreLog,
    });
    const connecting = handle.connect().catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await handle.stop();
    expect(host.killed).toBe(true);
    await expect(connecting).resolves.toBeInstanceOf(Error);
  }, 15_000);
});
