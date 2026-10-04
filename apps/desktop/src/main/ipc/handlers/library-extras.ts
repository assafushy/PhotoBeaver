import type { LibraryDb } from '@photobeaver/db';
import { appSettings } from '../../core/enrich/app-settings';
import type { DuplicatesService } from '../../core/enrich/duplicates-service';
import type { PeopleService } from '../../core/faces/people-service';
import { geoPoints, libraryFacets } from '../../library/facets';
import type { IpcRegistry } from '../registry';

export interface LibraryExtrasDeps {
  db: LibraryDb;
  duplicates: DuplicatesService;
  people: PeopleService;
}

function registerSearch(registry: IpcRegistry, { db }: LibraryExtrasDeps): void {
  registry.handle('library.facets', () => libraryFacets(db));
  registry.handle('library.geoPoints', ({ filter }) => geoPoints(db, filter));
  registry.handle('settings.get', () => appSettings.get(db));
  registry.handle('settings.set', (patch) => (appSettings.set(db, patch), null));
}

function registerPeopleEdits(registry: IpcRegistry, { people }: LibraryExtrasDeps): void {
  registry.handle('people.rename', ({ id, name }) => (people.rename(id, name), null));
  registry.handle('people.merge', ({ fromId, intoId }) => (people.merge(fromId, intoId), null));
  registry.handle('people.moveFaces', ({ faceIds, target }) => ({
    personId: people.moveFaces(faceIds, target),
  }));
  registry.handle('people.rejectFace', ({ faceId }) => (people.rejectFace(faceId), null));
  registry.handle(
    'people.setCover',
    ({ personId, faceId }) => (people.setCover(personId, faceId), null),
  );
}

function registerPeople(registry: IpcRegistry, deps: LibraryExtrasDeps): void {
  registry.handle('people.list', () => deps.people.list());
  registry.handle('people.faces', ({ id, after }) => deps.people.faces(id, after));
  registerPeopleEdits(registry, deps);
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
  registerPeople(registry, deps);
  registerDuplicates(registry, deps);
}
