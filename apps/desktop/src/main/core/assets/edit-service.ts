import { schema, type LibraryDb } from '@photobeaver/db';
import { inArray } from 'drizzle-orm';
import type { AccessScope } from '../access/scope';
import { writeAudit } from '../audit';
import { systemClock, type Clock } from '../clock';
import { refreshSearchText } from '../enrich/search-text';
import type { EventSink } from '../events/event-sink';
import { addUserTag, fallbackCapture, removeUserTag, userFields } from './edit-writes';
import { requireVisibleAssets } from './visible-assets';

const { assets } = schema;

/** Who asks for an edit: their id for the audit log and their scope. */
export interface EditActor {
  userId: string;
  scope: AccessScope | null;
}

export interface EditServiceDeps {
  db: LibraryDb;
  events: EventSink;
  replan(assetIds: readonly string[]): void;
  clock?: Clock;
}

interface EditRequest {
  action: string;
  ids: readonly string[];
  details?: Record<string, unknown>;
  write(db: LibraryDb, now: number): void;
}

/**
 * The Editor's changes to assets (SPEC 3.3, 6.3): favorite, hide, user tags,
 * date and location. User dates and locations rank above every other source.
 * Each edit is checked against the user's scope, refreshes search text, is
 * audited and tells the UI the library changed.
 */
export class EditService {
  private readonly clock: Clock;

  constructor(private readonly deps: EditServiceDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Marks or unmarks assets as favorites.
   *
   * @param actor - Who asks.
   * @param ids - Asset ids.
   * @param favorite - New value.
   */
  setFavorite(actor: EditActor, ids: readonly string[], favorite: boolean): void {
    this.apply(actor, {
      action: 'asset.favorite',
      ids,
      details: { favorite },
      write: (db, now) => this.setColumns(db, ids, { favorite: favorite ? 1 : 0, updatedAt: now }),
    });
  }

  /**
   * Hides or shows assets. Hidden assets leave the library, search and map.
   *
   * @param actor - Who asks.
   * @param ids - Asset ids.
   * @param hidden - New value.
   */
  setHidden(actor: EditActor, ids: readonly string[], hidden: boolean): void {
    this.apply(actor, {
      action: 'asset.hide',
      ids,
      details: { hidden },
      write: (db, now) => this.setColumns(db, ids, { hidden: hidden ? 1 : 0, updatedAt: now }),
    });
  }

  /**
   * Adds a user tag to assets.
   *
   * @param actor - Who asks.
   * @param ids - Asset ids.
   * @param name - Tag name.
   */
  addTag(actor: EditActor, ids: readonly string[], name: string): void {
    const write = (db: LibraryDb, now: number) => addUserTag(db, ids, name, now);
    this.apply(actor, { action: 'asset.tag', ids, details: { name }, write });
  }

  /**
   * Removes a user tag from assets.
   *
   * @param actor - Who asks.
   * @param ids - Asset ids.
   * @param name - Tag name.
   */
  removeTag(actor: EditActor, ids: readonly string[], name: string): void {
    const write = (db: LibraryDb) => removeUserTag(db, ids, name);
    this.apply(actor, { action: 'asset.untag', ids, details: { name }, write });
  }

  /**
   * Sets the capture time as the user's value, or clears the user's value so
   * the file's own date applies again (enrichment is planned again for it).
   *
   * @param actor - Who asks.
   * @param id - Asset id.
   * @param capturedAt - Floating local time in ms, or null to clear.
   */
  setCapturedAt(actor: EditActor, id: string, capturedAt: number | null): void {
    const clearing = capturedAt === null && userFields(this.deps.db, id).date;
    this.apply(actor, {
      action: 'asset.date',
      ids: [id],
      details: { capturedAt },
      write: (db, now) => this.writeDate(db, id, capturedAt, now),
    });
    if (clearing) this.deps.replan([id]);
  }

  /**
   * Sets the location as the user's value, or clears the user's value.
   *
   * @param actor - Who asks.
   * @param id - Asset id.
   * @param location - Coordinates, or null to clear.
   */
  setLocation(actor: EditActor, id: string, location: { lat: number; lon: number } | null): void {
    const clearing = location === null && userFields(this.deps.db, id).location;
    this.apply(actor, {
      action: 'asset.location',
      ids: [id],
      details: { location },
      write: (db, now) => this.writeLocation(db, id, location, now),
    });
    if (clearing) this.deps.replan([id]);
  }

  /**
   * Re-runs every enabled enricher on the given assets.
   *
   * @param actor - Who asks.
   * @param ids - Asset ids.
   */
  rerun(actor: EditActor, ids: readonly string[]): void {
    requireVisibleAssets(this.deps.db, actor.scope, ids);
    this.deps.replan(ids);
    writeAudit(this.deps.db, this.auditEntry(actor, 'asset.rerun', ids), this.clock());
  }

  private writeDate(db: LibraryDb, id: string, capturedAt: number | null, now: number): void {
    if (capturedAt !== null) {
      this.setColumns(db, [id], { capturedAt, capturedAtSource: 'user', updatedAt: now });
      return;
    }
    if (!userFields(db, id).date) return;
    const fallback = fallbackCapture(db, id);
    this.setColumns(db, [id], {
      capturedAt: fallback?.value ?? null,
      capturedAtSource: fallback?.source ?? null,
      updatedAt: now,
    });
  }

  private writeLocation(
    db: LibraryDb,
    id: string,
    location: { lat: number; lon: number } | null,
    now: number,
  ): void {
    if (location) {
      this.setColumns(db, [id], { ...location, locationSource: 'user', updatedAt: now });
      return;
    }
    if (!userFields(db, id).location) return;
    this.setColumns(db, [id], { lat: null, lon: null, locationSource: null, updatedAt: now });
  }

  private setColumns(
    db: LibraryDb,
    ids: readonly string[],
    values: Partial<typeof assets.$inferInsert>,
  ): void {
    db.update(assets)
      .set(values)
      .where(inArray(assets.id, [...ids]))
      .run();
  }

  private apply(actor: EditActor, request: EditRequest): void {
    const { db } = this.deps;
    requireVisibleAssets(db, actor.scope, request.ids);
    const now = this.clock();
    db.transaction((tx) => {
      const txDb = tx as unknown as LibraryDb;
      request.write(txDb, now);
      request.ids.forEach((id) => refreshSearchText(txDb, id));
      writeAudit(txDb, this.auditEntry(actor, request.action, request.ids, request.details), now);
    });
    this.deps.events.emit('library.changed', {});
  }

  private auditEntry(
    actor: EditActor,
    action: string,
    ids: readonly string[],
    details: Record<string, unknown> = {},
  ) {
    return {
      userId: actor.userId || null,
      action,
      targetType: 'asset',
      targetId: ids.length === 1 ? ids[0] : undefined,
      details: { count: ids.length, ...details },
    };
  }
}
