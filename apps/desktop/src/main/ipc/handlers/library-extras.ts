import type { LibraryDb } from '@photobeaver/db';
import { appSettings } from '../../core/enrich/app-settings';
import type { DuplicatesService } from '../../core/enrich/duplicates-service';
import { geoPoints, libraryFacets } from '../../library/facets';
import type { IpcRegistry } from '../registry';

export interface LibraryExtrasDeps {
  db: LibraryDb;
  duplicates: DuplicatesService;
}

function registerSearch(registry: IpcRegistry, { db }: LibraryExtrasDeps): void {
  registry.handle('library.facets', () => libraryFacets(db));
  registry.handle('library.geoPoints', ({ filter }) => geoPoints(db, filter));
  registry.handle('settings.get', () => appSettings.get(db));
  registry.handle('settings.set', (patch) => (appSettings.set(db, patch), null));
}

function registerDuplicates(registry: IpcRegistry, { duplicates }: LibraryExtrasDeps): void {
  registry.handle('duplicates.list', () => duplicates.list());
  registry.handle(
    'duplicates.merge',
    ({ id, keepAssetId }, ctx) => (duplicates.merge(id, keepAssetId, ctx.user.id), null),
  );
  registry.handle(
    'duplicates.dismiss',
    ({ id }, ctx) => (duplicates.dismiss(id, ctx.user.id), null),
  );
  registry.handle('merges.recent', () => duplicates.recentMerges());
  registry.handle('merges.undo', ({ id }, ctx) => (duplicates.undo(id, ctx.user.id), null));
}

/**
 * Registers search facets, map points, app settings and the Duplicates screen channels.
 *
 * @param registry - The permission-checked registry.
 * @param deps - Database and duplicates service.
 */
export function registerLibraryExtras(registry: IpcRegistry, deps: LibraryExtrasDeps): void {
  registerSearch(registry, deps);
  registerDuplicates(registry, deps);
}
