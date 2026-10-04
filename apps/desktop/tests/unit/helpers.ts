import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openLibrary, schema, type OpenLibrary } from '@photobeaver/db';
import { ROLE_PERMISSIONS, type Role, type SessionUser } from '@photobeaver/shared';
import type { IpcTransport, RawListener } from '../../src/main/ipc/registry';

export interface TempLibrary {
  library: OpenLibrary;
  dir: string;
  cleanup(): void;
}

/**
 * Opens a fresh migrated library in a temporary directory.
 *
 * @returns The open library and a cleanup function.
 */
export async function openTempLibrary(): Promise<TempLibrary> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pb-desktop-test-'));
  const library = await openLibrary({ libraryDir: path.join(dir, 'library') });
  return {
    library,
    dir,
    cleanup: () => {
      library.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

/**
 * Builds a session user with the permissions of a role.
 *
 * @param role - The role to impersonate.
 * @returns A session user.
 */
export function userWithRole(role: Role): SessionUser {
  return { id: `${role}-1`, displayName: role, role, permissions: [...ROLE_PERMISSIONS[role]] };
}

/**
 * In-memory IPC transport that lets tests invoke registered channels.
 */
export class FakeTransport implements IpcTransport {
  readonly listeners = new Map<string, RawListener>();

  handle(channel: string, listener: RawListener): void {
    this.listeners.set(channel, listener);
  }

  invoke(channel: string, raw?: unknown): ReturnType<RawListener> {
    const listener = this.listeners.get(channel);
    if (!listener) throw new Error(`No listener for ${channel}`);
    return listener(raw);
  }
}

export const silentLogger = { warn: () => undefined, error: () => undefined };

/**
 * Inserts a plugins row for tests.
 *
 * @param temp - Temp library.
 * @param id - Plugin id.
 * @param overrides - Column overrides.
 */
export function insertPlugin(
  temp: TempLibrary,
  id: string,
  overrides: Partial<typeof schema.plugins.$inferInsert> = {},
): void {
  temp.library.db
    .insert(schema.plugins)
    .values({
      id,
      version: '1.0.0',
      type: 'connector',
      manifestJson: '{}',
      grantedPermissionsJson: '{}',
      installSource: 'builtin',
      ...overrides,
    })
    .run();
}

export interface TestSource {
  id: string;
  pluginId: string;
  nextRunAt?: number;
  mode?: 'poll' | 'watch' | 'manual';
  syncState?: (typeof schema.sources.$inferSelect)['syncState'];
  config?: unknown;
}

/**
 * Inserts a sources row for tests.
 *
 * @param temp - Temp library.
 * @param source - Source fields.
 */
export function insertSource(temp: TempLibrary, source: TestSource): void {
  temp.library.db
    .insert(schema.sources)
    .values({
      id: source.id,
      pluginId: source.pluginId,
      displayName: source.id,
      configJson: JSON.stringify(source.config ?? {}),
      scheduleJson: JSON.stringify({ intervalSec: 3600, mode: source.mode ?? 'poll' }),
      syncState: source.syncState ?? 'idle',
      nextRunAt: source.nextRunAt ?? 0,
      createdAt: 0,
    })
    .run();
}

const noop = (): void => undefined;

export const silentCoreLog = {
  child: () => silentCoreLog,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
