import type { LibraryDb } from '@photobeaver/db';
import type { AppInfo } from '@photobeaver/shared';
import { queryLibraryPage } from '../../library/library-service';
import type { IpcRegistry } from '../registry';

export interface HandlerDeps {
  db: LibraryDb;
  appInfo: () => AppInfo;
}

/**
 * Registers every M0 IPC handler and verifies the contract is fully covered.
 *
 * @param registry - The permission-checked registry.
 * @param deps - Services the handlers depend on.
 */
export function registerHandlers(registry: IpcRegistry, deps: HandlerDeps): void {
  registry.handle('app.info', () => deps.appInfo());
  registry.handle('session.current', (_input, ctx) => ctx.user);
  registry.handle('library.query', (input) => queryLibraryPage(deps.db, input));
  registry.assertComplete();
}
