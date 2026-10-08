import type { LibraryDb } from '@photobeaver/db';
import { listAudit } from '../../core/audit';
import type { UserService } from '../../core/users/user-service';
import type { SessionService } from '../../session/session-service';
import type { IpcRegistry } from '../registry';

export interface UserHandlerDeps {
  db: LibraryDb;
  users: UserService;
  session: SessionService;
  biometricAvailable: () => boolean;
}

function registerAccounts(registry: IpcRegistry, { users, session }: UserHandlerDeps): void {
  const refreshing = <T>(value: T): T => (session.refresh(), value);
  registry.handle('users.list', () => users.list());
  registry.handle('users.create', (draft, ctx) => users.create(draft, ctx.user.id));
  registry.handle('users.update', async (changes, ctx) =>
    refreshing(await users.update(changes, ctx.user.id)),
  );
  registry.handle('users.delete', ({ id }, ctx) =>
    refreshing((users.delete(id, ctx.user.id), null)),
  );
  registry.handle('users.setScopes', ({ id, ...scopes }, ctx) =>
    refreshing((users.setScopes(id, scopes, ctx.user.id), null)),
  );
}

function registerMultiUser(registry: IpcRegistry, deps: UserHandlerDeps): void {
  const { users, session } = deps;
  registry.handle('users.settings', () => users.settings(deps.biometricAvailable()));
  registry.handle('users.enableMulti', async ({ password }, ctx) => ({
    recoveryKey: await users.enableMultiUser(ctx.user.id, password),
  }));
  registry.handle('users.disableMulti', async ({ password }, ctx) => {
    await users.disableMultiUser(ctx.user.id, password);
    session.resetToImplicitAdmin();
    return null;
  });
  registry.handle(
    'users.setAutoLock',
    ({ minutes }, ctx) => (users.setAutoLock(minutes, ctx.user.id), null),
  );
}

/**
 * The Users screen, multiple-users settings and the Activity log (SPEC 3.3).
 * Changes that can affect the signed-in user refresh their session.
 *
 * @param registry - The permission-checked registry.
 * @param deps - Database, user and session services.
 */
export function registerUserHandlers(registry: IpcRegistry, deps: UserHandlerDeps): void {
  registerAccounts(registry, deps);
  registerMultiUser(registry, deps);
  registry.handle('audit.list', ({ before, limit }) => listAudit(deps.db, before, limit));
}
