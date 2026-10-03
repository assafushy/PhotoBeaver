import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { MessageChannelMain, utilityProcess } from 'electron';
import type { HostLauncher, LaunchedHost, LaunchOptions } from '../core/plugins/host-launcher';
import { messagePortTransport } from '../../plugin-host/message-port';

const PASSED_ENV = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];

function hostEnv(): Record<string, string> {
  return Object.fromEntries(
    PASSED_ENV.flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])),
  );
}

function pipeOutput(child: Electron.UtilityProcess, logFile: string): void {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const out = createWriteStream(logFile, { flags: 'a' });
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  child.once('exit', () => out.end());
}

function forkHost(entry: string, options: LaunchOptions): Electron.UtilityProcess {
  return utilityProcess.fork(entry, [], {
    serviceName: `Photo Beaver plugin ${options.pluginId}`,
    stdio: 'pipe',
    env: hostEnv(),
    execArgv: [`--max-old-space-size=${options.maxOldSpaceMb}`],
  });
}

function connectHost(child: Electron.UtilityProcess): LaunchedHost {
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage({ type: 'connect' }, [port2]);
  return {
    port: messagePortTransport(port1),
    get pid() {
      return child.pid;
    },
    kill: () => void child.kill(),
    onExit: (listener) => void child.on('exit', listener),
  };
}

/**
 * Starts each plugin host as an Electron `utilityProcess` (SPEC 3.1, 6.5, 6.6):
 * its own Node process, a memory cap, a minimal environment, stdout and
 * stderr appended to the plugin's log, and a MessagePort for JSON-RPC.
 *
 * @param entry - Built plugin host script.
 * @returns The launcher.
 */
export function utilityProcessLauncher(entry: string): HostLauncher {
  return {
    launch(options: LaunchOptions): LaunchedHost {
      const child = forkHost(entry, options);
      pipeOutput(child, options.logFile);
      return connectHost(child);
    },
  };
}
