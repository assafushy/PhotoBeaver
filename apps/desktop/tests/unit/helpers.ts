import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openLibrary, type OpenLibrary } from '@photobeaver/db';
import { ROLE_PERMISSIONS, type Role, type SessionUser } from '@photobeaver/shared';
import type { IpcTransport, RawListener } from '../../src/main/ipc/registry';

export interface TempLibrary {
  library: OpenLibrary;
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
    cleanup: () => {
      library.close();
      rmSync(dir, { recursive: true, force: true });
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
