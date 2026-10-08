import { writeAudit } from '../../core/audit';
import type { LibraryDb } from '@photobeaver/db';
import { appSettings } from '../../core/enrich/app-settings';
import type { DuplicatesService } from '../../core/enrich/duplicates-service';
import type { PeopleService } from '../../core/faces/people-service';
import { geoPoints, libraryFacets } from '../../library/facets';
import type { HandlerContext, IpcRegistry } from '../registry';

export interface LibraryExtrasDeps {
  db: LibraryDb;
  duplicates: DuplicatesService;
  people: PeopleService;
}

function registerSearch(registry: IpcRegistry, { db }: LibraryExtrasDeps): void {
  registry.handle('library.facets', (_input, ctx) => libraryFacets(db, ctx.scope));
  registry.handle('library.geoPoints', ({ filter }, ctx) => geoPoints(db, filter, ctx.scope));
  registry.handle('settings.get', () => appSettings.get(db));
  registry.handle('settings.set', (patch, ctx) => {
    appSettings.set(db, patch);
    writeAudit(db, { userId: ctx.user.id, action: 'settings.set', details: patch }, Date.now());
    return null;
  });
}

function audited(db: LibraryDb, ctx: HandlerContext, action: string, details: object): null {
  writeAudit(db, { userId: ctx.user.id, action, targetType: 'person', details }, Date.now());
  return null;
}

function registerPersonEdits(registry: IpcRegistry, { db, people }: LibraryExtrasDeps): void {
  registry.handle('people.rename', ({ id, name }, ctx) => {
    people.rename(id, name, ctx.scope);
    return audited(db, ctx, 'person.rename', { id, name });
  });
  registry.handle('people.merge', ({ fromId, intoId }, ctx) => {
    people.merge(fromId, intoId, ctx.scope);
    return audited(db, ctx, 'person.merge', { fromId, intoId });
  });
}

function registerFaceEdits(registry: IpcRegistry, { db, people }: LibraryExtrasDeps): void {
  registry.handle('people.moveFaces', ({ faceIds, target }, ctx) => {
    const personId = people.moveFaces(faceIds, target, ctx.scope);
    audited(db, ctx, 'person.move_faces', { personId, count: faceIds.length });
    return { personId };
  });
  registry.handle('people.rejectFace', ({ faceId }, ctx) => {
    people.rejectFace(faceId, ctx.scope);
    return audited(db, ctx, 'person.reject_face', { faceId });
  });
  registry.handle(
    'people.setCover',
    ({ personId, faceId }, ctx) => (people.setCover(personId, faceId, ctx.scope), null),
  );
}

function registerPeople(registry: IpcRegistry, deps: LibraryExtrasDeps): void {
  registry.handle('people.list', (_input, ctx) => deps.people.list(ctx.scope));
  registry.handle('people.faces', ({ id, after }, ctx) => deps.people.faces(id, after, ctx.scope));
  registerPersonEdits(registry, deps);
  registerFaceEdits(registry, deps);
}

function registerDuplicates(registry: IpcRegistry, { duplicates }: LibraryExtrasDeps): void {
  registry.handle('duplicates.list', (_input, ctx) => duplicates.list(ctx.scope));
  registry.handle(
    'duplicates.merge',
    ({ id, keepAssetId }, ctx) => (duplicates.merge(id, keepAssetId, ctx.user.id, ctx.scope), null),
  );
  registry.handle(
    'duplicates.dismiss',
    ({ id }, ctx) => (duplicates.dismiss(id, ctx.user.id, ctx.scope), null),
  );
  registry.handle('merges.recent', (_input, ctx) => duplicates.recentMerges(ctx.scope));
  registry.handle(
    'merges.undo',
    ({ id }, ctx) => (duplicates.undo(id, ctx.user.id, ctx.scope), null),
  );
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
