import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ConnectorPlugin } from '@photobeaver/plugin-sdk';
import { createMemoryPortPair, type HostInit } from '@photobeaver/shared/rpc';
import type { HostLauncher, LaunchedHost } from '../../src/main/core/plugins/host-launcher';
import { startHostRuntime } from '../../src/plugin-host/runtime';

/**
 * Runs the real host runtime in-process over memory ports, standing in for
 * `utilityProcess`. `kill()` closes the ports and reports an exit, like a crash.
 */
export class MemoryLauncher implements HostLauncher {
  launches = 0;
  current: LaunchedHost | null = null;

  constructor(private readonly plugin: ConnectorPlugin<unknown>) {}

  launch(): LaunchedHost {
    const [core, host] = createMemoryPortPair();
    startHostRuntime(host, {
      installGuards: false,
      loadModule: async () => ({ default: this.plugin }),
    });
    const exitListeners: ((code: number | null) => void)[] = [];
    core.onClose(() => exitListeners.forEach((l) => l(null)));
    this.launches++;
    this.current = {
      port: core,
      pid: 1000 + this.launches,
      kill: () => core.close(),
      onExit: (l) => void exitListeners.push(l),
    };
    return this.current;
  }
}

/**
 * Host init params for tests.
 *
 * @param pluginId - Plugin id.
 * @returns Init params with temp folders.
 */
export function testHostInit(pluginId: string): HostInit {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-host-'));
  return {
    pluginId,
    pluginDir: dir,
    main: 'index.js',
    dataDir: dir,
    tempDir: dir,
    network: [],
    filesystem: 'user-selected',
    grantedDirs: [],
  };
}
