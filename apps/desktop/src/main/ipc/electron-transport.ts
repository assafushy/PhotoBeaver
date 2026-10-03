import { ipcMain } from 'electron';
import type { IpcTransport } from './registry';

/**
 * Adapts Electron's ipcMain to the registry transport.
 *
 * @returns A transport that ignores the sender event and forwards the payload.
 */
export function electronTransport(): IpcTransport {
  return {
    handle: (channel, listener) => ipcMain.handle(channel, (_event, raw: unknown) => listener(raw)),
  };
}
