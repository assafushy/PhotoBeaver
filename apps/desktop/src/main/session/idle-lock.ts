import type { LibraryDb } from '@photobeaver/db';
import { powerMonitor } from 'electron';
import { userSettings } from '../core/users/user-settings';
import type { SessionService } from './session-service';

const CHECK_MS = 30_000;

/**
 * Locks the app after the configured idle time and when the OS screen locks
 * (SPEC 3.3; only with multiple users). Background work keeps running.
 *
 * @param db - Database (settings).
 * @param session - The session service.
 * @returns A function that stops the checks.
 */
export function startIdleLock(db: LibraryDb, session: SessionService): () => void {
  const check = () => {
    const minutes = userSettings.autoLockMinutes(db);
    if (minutes > 0 && powerMonitor.getSystemIdleTime() >= minutes * 60) session.lock();
  };
  const onScreenLock = () => session.lock();
  const timer = setInterval(check, CHECK_MS);
  timer.unref();
  powerMonitor.on('lock-screen', onScreenLock);
  return () => (clearInterval(timer), powerMonitor.off('lock-screen', onScreenLock));
}
