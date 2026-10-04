import type { RpcPort } from '@photobeaver/shared/rpc';

export interface LaunchOptions {
  pluginId: string;
  maxOldSpaceMb: number;
  logFile: string;
}

export interface LaunchedHost {
  port: RpcPort;
  pid: number | undefined;
  kill(): void;
  onExit(listener: (code: number | null) => void): void;
}

/**
 * Starts a plugin host process. The Electron implementation forks a
 * `utilityProcess`; tests run the host runtime in-process over memory ports.
 */
export interface HostLauncher {
  launch(options: LaunchOptions): LaunchedHost;
}
