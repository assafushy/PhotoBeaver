import { schema, type LibraryDb } from '@photobeaver/db';
import type { AlbumSummary } from '@photobeaver/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { AccessScope } from '../access/scope';
import type { EditActor } from '../assets/edit-service';
import { requireVisibleAssets } from '../assets/visible-assets';
import { writeAudit } from '../audit';
import { systemClock, type Clock } from '../clock';
import type { EventSink } from '../events/event-sink';
import {
  albumSummary,
  listAlbums,
  nextPosition,
  visibleAlbum,
  type AlbumRow,
} from './album-queries';

const { albums, albumAssets, userScopes } = schema;

export interface AlbumServiceDeps {
  db: LibraryDb;
  events: EventSink;
  clock?: Clock;
}

interface AlbumChange {
  action: string;
  albumId: string;
  details: Record<string, unknown>;
  write(db: LibraryDb, now: number): void;
}

/**
 * Albums (SPEC 3.3, 4.2). User albums (no source) can be created, renamed,
 * deleted and filled; albums that come from a source are read-only. A scoped
 * user sees only the albums in their scope and those of their sources, and
 * can only add assets they can see. Every change is audited.
 */
export class AlbumService {
  private readonly clock: Clock;

  constructor(private readonly deps: AlbumServiceDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * The albums the user can see.
   *
   * @param scope - The user's scope.
   * @returns Album summaries.
   */
  list(scope: AccessScope | null): AlbumSummary[] {
    return listAlbums(this.deps.db, scope);
  }

  /**
   * Creates an empty user album. A scoped creator gets it added to their scope
   * so they can see what they made.
   *
   * @param actor - Who asks.
   * @param name - Album name.
   * @returns The new album.
   */
  create(actor: EditActor, name: string): AlbumSummary {
    const now = this.clock();
    const album: AlbumRow = {
      id: ulid(now),
      name,
      sourceId: null,
      externalId: null,
      createdAt: now,
    };
    this.change(actor, {
      action: 'album.create',
      albumId: album.id,
      details: { name },
      write: (db) => this.insertAlbum(db, actor, album),
    });
    const scope = actor.scope && { ...actor.scope, albumIds: [...actor.scope.albumIds, album.id] };
    return albumSummary(this.deps.db, scope, album);
  }

  /**
   * Renames a user album.
   *
   * @param actor - Who asks.
   * @param id - Album id.
   * @param name - New name.
   */
  rename(actor: EditActor, id: string, name: string): void {
    this.requireUserAlbum(actor.scope, id);
    this.change(actor, {
      action: 'album.rename',
      albumId: id,
      details: { name },
      write: (db) => db.update(albums).set({ name }).where(eq(albums.id, id)).run(),
    });
  }

  /**
   * Deletes a user album (its assets stay in the library).
   *
   * @param actor - Who asks.
   * @param id - Album id.
   */
  delete(actor: EditActor, id: string): void {
    const album = this.requireUserAlbum(actor.scope, id);
    this.change(actor, {
      action: 'album.delete',
      albumId: id,
      details: { name: album.name },
      write: (db) => this.deleteAlbum(db, id),
    });
  }

  /**
   * Appends assets to a user album (assets already in it keep their place).
   *
   * @param actor - Who asks.
   * @param id - Album id.
   * @param assetIds - Assets to add.
   */
  addAssets(actor: EditActor, id: string, assetIds: readonly string[]): void {
    this.requireUserAlbum(actor.scope, id);
    requireVisibleAssets(this.deps.db, actor.scope, assetIds);
    this.change(actor, {
      action: 'album.add',
      albumId: id,
      details: { count: assetIds.length },
      write: (db) => this.appendAssets(db, id, assetIds),
    });
  }

  /**
   * Removes assets from a user album.
   *
   * @param actor - Who asks.
   * @param id - Album id.
   * @param assetIds - Assets to remove.
   */
  removeAssets(actor: EditActor, id: string, assetIds: readonly string[]): void {
    this.requireUserAlbum(actor.scope, id);
    requireVisibleAssets(this.deps.db, actor.scope, assetIds);
    const where = and(eq(albumAssets.albumId, id), inArray(albumAssets.assetId, [...assetIds]));
    this.change(actor, {
      action: 'album.remove',
      albumId: id,
      details: { count: assetIds.length },
      write: (db) => db.delete(albumAssets).where(where).run(),
    });
  }

  private requireUserAlbum(scope: AccessScope | null, id: string): AlbumRow {
    const album = visibleAlbum(this.deps.db, scope, id);
    if (!album) throw new Error('Not found');
    if (album.sourceId) throw new Error('Albums from a source are read-only');
    return album;
  }

  private insertAlbum(db: LibraryDb, actor: EditActor, album: AlbumRow): void {
    db.insert(albums).values(album).run();
    if (!actor.scope) return;
    db.insert(userScopes)
      .values({ userId: actor.userId, scopeType: 'album', scopeId: album.id })
      .run();
  }

  private deleteAlbum(db: LibraryDb, id: string): void {
    db.delete(albums).where(eq(albums.id, id)).run();
    db.delete(userScopes)
      .where(and(eq(userScopes.scopeType, 'album'), eq(userScopes.scopeId, id)))
      .run();
  }

  private appendAssets(db: LibraryDb, id: string, assetIds: readonly string[]): void {
    let position = nextPosition(db, id);
    for (const assetId of new Set(assetIds)) {
      const row = { albumId: id, assetId, position };
      if (db.insert(albumAssets).values(row).onConflictDoNothing().run().changes > 0) position++;
    }
  }

  private change(actor: EditActor, change: AlbumChange): void {
    const now = this.clock();
    this.deps.db.transaction((tx) => {
      const db = tx as unknown as LibraryDb;
      change.write(db, now);
      writeAudit(
        db,
        {
          userId: actor.userId || null,
          action: change.action,
          targetType: 'album',
          targetId: change.albumId,
          details: change.details,
        },
        now,
      );
    });
    this.deps.events.emit('library.changed', {});
  }
}
