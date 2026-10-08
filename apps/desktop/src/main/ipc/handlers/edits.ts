import type { LibraryDb } from '@photobeaver/db';
import { AlbumService } from '../../core/albums/album-service';
import { EditService, type EditActor } from '../../core/assets/edit-service';
import type { Clock } from '../../core/clock';
import type { EventSink } from '../../core/events/event-sink';
import type { HandlerContext, IpcRegistry } from '../registry';

export interface EditHandlerDeps {
  db: LibraryDb;
  events: EventSink;
  replan(assetIds: readonly string[]): void;
  refreshSession(): void;
  clock?: Clock;
}

const actorOf = (ctx: HandlerContext): EditActor => ({ userId: ctx.user.id, scope: ctx.scope });

function registerFlagEdits(registry: IpcRegistry, edits: EditService): void {
  registry.handle(
    'assets.setFavorite',
    ({ ids, favorite }, ctx) => (edits.setFavorite(actorOf(ctx), ids, favorite), null),
  );
  registry.handle(
    'assets.setHidden',
    ({ ids, hidden }, ctx) => (edits.setHidden(actorOf(ctx), ids, hidden), null),
  );
  registry.handle(
    'assets.addTag',
    ({ ids, name }, ctx) => (edits.addTag(actorOf(ctx), ids, name), null),
  );
  registry.handle(
    'assets.removeTag',
    ({ ids, name }, ctx) => (edits.removeTag(actorOf(ctx), ids, name), null),
  );
}

function registerFieldEdits(registry: IpcRegistry, edits: EditService): void {
  registry.handle(
    'assets.setDate',
    ({ id, capturedAt }, ctx) => (edits.setCapturedAt(actorOf(ctx), id, capturedAt), null),
  );
  registry.handle(
    'assets.setLocation',
    ({ id, location }, ctx) => (edits.setLocation(actorOf(ctx), id, location), null),
  );
  registry.handle('assets.rerun', ({ ids }, ctx) => (edits.rerun(actorOf(ctx), ids), null));
}

function registerAlbums(registry: IpcRegistry, albums: AlbumService, deps: EditHandlerDeps): void {
  registry.handle('albums.list', (_input, ctx) => albums.list(ctx.scope));
  registry.handle('albums.create', ({ name }, ctx) => {
    const album = albums.create(actorOf(ctx), name);
    if (ctx.scope) deps.refreshSession();
    return album;
  });
  registry.handle(
    'albums.rename',
    ({ id, name }, ctx) => (albums.rename(actorOf(ctx), id, name), null),
  );
  registry.handle('albums.delete', ({ id }, ctx) => (albums.delete(actorOf(ctx), id), null));
  registry.handle(
    'albums.addAssets',
    ({ id, assetIds }, ctx) => (albums.addAssets(actorOf(ctx), id, assetIds), null),
  );
  registry.handle(
    'albums.removeAssets',
    ({ id, assetIds }, ctx) => (albums.removeAssets(actorOf(ctx), id, assetIds), null),
  );
}

/**
 * The Editor's asset edits, "Re-run enrichment" and albums (SPEC 3.3).
 * Every handler passes the signed-in user's scope down to core.
 *
 * @param registry - The permission-checked registry.
 * @param deps - Database, events, enrichment re-planning and session refresh.
 */
export function registerEditHandlers(registry: IpcRegistry, deps: EditHandlerDeps): void {
  const { db, events, clock } = deps;
  const edits = new EditService({ db, events, replan: deps.replan, clock });
  registerFlagEdits(registry, edits);
  registerFieldEdits(registry, edits);
  registerAlbums(registry, new AlbumService({ db, events, clock }), deps);
}
