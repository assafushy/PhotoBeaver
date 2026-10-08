import type { SessionService } from '../../session/session-service';
import type { IpcRegistry } from '../registry';

/**
 * Sign-in, the user picker and locking (SPEC 3.3). These channels are public:
 * they work while the app is locked.
 *
 * @param registry - The permission-checked registry.
 * @param session - The session service.
 */
export function registerSessionHandlers(registry: IpcRegistry, session: SessionService): void {
  registry.handle('session.current', () => session.state());
  registry.handle('auth.users', () => session.pickerUsers());
  registry.handle('auth.signIn', ({ userId, secret }) => session.signIn(userId, secret));
  registry.handle('auth.signInBiometric', ({ userId }) => session.signInBiometric(userId));
  registry.handle('auth.recover', ({ recoveryKey, newPassword }) =>
    session.recover(recoveryKey, newPassword),
  );
  registry.handle('auth.lock', () => (session.lock(), null));
}
