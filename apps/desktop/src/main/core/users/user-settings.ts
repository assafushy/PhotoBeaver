import type { LibraryDb } from '@photobeaver/db';
import { readSetting, writeSetting } from '../settings-store';

const KEYS = {
  multiUser: 'users.multiUser',
  autoLock: 'users.autoLockMinutes',
  recovery: 'users.recoveryKeyHash',
} as const;

export const DEFAULT_AUTO_LOCK_MINUTES = 15;

/**
 * Library-wide user settings (SPEC 3.3): whether multiple users are on, the
 * auto-lock time and the recovery key hash.
 */
export const userSettings = {
  multiUser: (db: LibraryDb): boolean => readSetting(db, KEYS.multiUser, false),
  setMultiUser: (db: LibraryDb, on: boolean): void => writeSetting(db, KEYS.multiUser, on),
  autoLockMinutes: (db: LibraryDb): number =>
    readSetting(db, KEYS.autoLock, DEFAULT_AUTO_LOCK_MINUTES),
  setAutoLockMinutes: (db: LibraryDb, minutes: number): void =>
    writeSetting(db, KEYS.autoLock, minutes),
  recoveryHash: (db: LibraryDb): string | null =>
    readSetting<string | null>(db, KEYS.recovery, null),
  setRecoveryHash: (db: LibraryDb, hash: string | null): void =>
    writeSetting(db, KEYS.recovery, hash),
};
