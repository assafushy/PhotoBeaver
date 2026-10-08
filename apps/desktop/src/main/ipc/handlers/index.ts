import type { SessionService } from '../../session/session-service';
import { registerSessionHandlers } from './session';
import { registerEditHandlers, type EditHandlerDeps } from './edits';
import { registerUserHandlers, type UserHandlerDeps } from './users';
import type { LibraryDb } from '@photobeaver/db';
import type { AppInfo } from '@photobeaver/shared';
import { getAssetDetail, instanceExternalUrl } from '../../core/assets/asset-service';
import type { SourceService } from '../../core/sources/source-service';
import { queryLibraryPage } from '../../library/library-service';
import { sourceVisible } from '../../core/access/scope';
import type { HandlerContext, IpcRegistry } from '../registry';
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
  edits: EditHandlerDeps;
}

function registerLibraryHandlers(registry: IpcRegistry, deps: HandlerDeps): void {
  registry.handle('app.info', () => deps.appInfo());
  registry.handle('app.capabilities', () => deps.capabilities());
  registry.handle('library.query', (input, ctx) => queryLibraryPage(deps.db, input, ctx.scope));
  registry.handle('assets.get', ({ id }, ctx) => getAssetDetail(deps.db, id, ctx.scope));
  registry.handle('assets.openInSource', async ({ id }, ctx) => {
    const url = instanceExternalUrl(deps.db, id, ctx.scope);
    if (url) await deps.openExternalUrl(url);
    return null;
  });
}

function visibleSourceId(ctx: HandlerContext, id: string): string {
  if (!sourceVisible(ctx.scope, id)) throw new Error(`Source not found: ${id}`);
  return id;
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
  registry.handle('sources.list', (_input, ctx) => sources.list(ctx.scope));
  registry.handle('sources.connectors', () => sources.connectors());
  registry.handle(
    'sources.remove',
    async ({ id }, ctx) => (await sources.remove(id, ctx.user.id), null),
  );
  registry.handle('sources.pickDirectory', () => deps.pickDirectory());
  registerSourceSyncHandlers(registry, deps);
}

function registerSourceSyncHandlers(registry: IpcRegistry, { sources }: HandlerDeps): void {
  registry.handle(
    'sources.syncNow',
    ({ id }, ctx) => (sources.syncNow(visibleSourceId(ctx, id)), null),
  );
  registry.handle(
    'sources.pause',
    ({ id }, ctx) => (sources.pause(visibleSourceId(ctx, id)), null),
  );
  registry.handle(
    'sources.resume',
    ({ id }, ctx) => (sources.resume(visibleSourceId(ctx, id)), null),
  );
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
  registerEditHandlers(registry, deps.edits);
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
