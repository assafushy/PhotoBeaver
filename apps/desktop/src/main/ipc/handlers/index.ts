import type { SessionService } from '../../session/session-service';
import { registerSessionHandlers } from './session';
import { registerUserHandlers, type UserHandlerDeps } from './users';
import type { LibraryDb } from '@photobeaver/db';
import type { AppInfo } from '@photobeaver/shared';
import { getAssetDetail, instanceExternalUrl } from '../../core/assets/asset-service';
import type { SourceService } from '../../core/sources/source-service';
import { queryLibraryPage } from '../../library/library-service';
import type { IpcRegistry } from '../registry';
import { registerLibraryExtras } from './library-extras';
import { registerPluginHandlers, type PluginHandlerDeps } from './plugins';
import type { DuplicatesService } from '../../core/enrich/duplicates-service';
import type { PeopleService } from '../../core/faces/people-service';

export interface HandlerDeps {
  db: LibraryDb;
  sources: SourceService;
  appInfo: () => AppInfo;
  pickDirectory: () => Promise<string | null>;
  openExternalUrl: (url: string) => Promise<void>;
  plugins: PluginHandlerDeps;
  duplicates: DuplicatesService;
  people: PeopleService;
  session: SessionService;
  users: UserHandlerDeps;
  capabilities: () => { faces: boolean; merge: boolean };
}

function registerLibraryHandlers(registry: IpcRegistry, deps: HandlerDeps): void {
  registry.handle('app.info', () => deps.appInfo());
  registry.handle('app.capabilities', () => deps.capabilities());
  registry.handle('library.query', (input) => queryLibraryPage(deps.db, input));
  registry.handle('assets.get', ({ id }) => getAssetDetail(deps.db, id));
  registry.handle('assets.openInSource', async ({ id }) => {
    const url = instanceExternalUrl(deps.db, id);
    if (url) await deps.openExternalUrl(url);
    return null;
  });
}

function registerSourceSetupHandlers(registry: IpcRegistry, { sources }: HandlerDeps): void {
  registry.handle('sources.add', (input, ctx) => sources.add(input, ctx.user.id));
  registry.handle('sources.reconnect', ({ id, setupId }, ctx) =>
    sources.reconnect(id, setupId, ctx.user.id),
  );
  registry.handle('sources.cancelSetup', ({ setupId }) => (sources.cancelSetup(setupId), null));
}

function registerSourceHandlers(registry: IpcRegistry, deps: HandlerDeps): void {
  const { sources } = deps;
  registerSourceSetupHandlers(registry, deps);
  registry.handle('sources.list', () => sources.list());
  registry.handle('sources.connectors', () => sources.connectors());
  registry.handle(
    'sources.remove',
    async ({ id }, ctx) => (await sources.remove(id, ctx.user.id), null),
  );
  registry.handle('sources.pickDirectory', () => deps.pickDirectory());
  registry.handle('sources.syncNow', ({ id }) => (sources.syncNow(id), null));
  registry.handle('sources.pause', ({ id }) => (sources.pause(id), null));
  registry.handle('sources.resume', ({ id }) => (sources.resume(id), null));
}

/**
 * Registers every IPC handler and verifies the contract is fully covered.
 *
 * @param registry - The permission-checked registry.
 * @param deps - Services the handlers depend on.
 */
export function registerHandlers(registry: IpcRegistry, deps: HandlerDeps): void {
  registerSessionHandlers(registry, deps.session);
  registerUserHandlers(registry, deps.users);
  registerLibraryHandlers(registry, deps);
  registerSourceHandlers(registry, deps);
  registerPluginHandlers(registry, deps.plugins);
  registerLibraryExtras(registry, {
    db: deps.db,
    duplicates: deps.duplicates,
    people: deps.people,
  });
  registry.assertComplete();
}
