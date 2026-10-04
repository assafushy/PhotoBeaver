import type { LibraryDb } from '@photobeaver/db';
import type { DevSocketServer } from './dev-socket-server';
import { pluginRows } from './plugin-rows';

/**
 * Developer mode (SPEC 5.4 "Dev", 5.5): a persisted switch that gates loading
 * unpacked plugins and the dev socket `pb-plugin dev` talks to.
 */
export class DeveloperMode {
  constructor(
    private readonly db: LibraryDb,
    private readonly server: DevSocketServer,
  ) {}

  get enabled(): boolean {
    return pluginRows.developerMode(this.db);
  }

  /** Starts the dev socket when developer mode was left on. */
  async start(): Promise<void> {
    if (this.enabled) await this.server.start().catch(() => undefined);
  }

  /**
   * Turns developer mode on or off, starting or stopping the dev socket.
   *
   * @param enabled - New state.
   */
  async set(enabled: boolean): Promise<void> {
    pluginRows.setDeveloperMode(this.db, enabled);
    if (enabled) await this.server.start();
    else await this.server.stop();
  }

  /** Stops the dev socket without changing the setting (quit). */
  async stop(): Promise<void> {
    await this.server.stop();
  }

  /** Throws unless developer mode is on. */
  assertEnabled(): void {
    if (!this.enabled) throw new Error('Turn on developer mode to load unpacked plugins');
  }
}
