import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { AccessScope } from '../access/scope';
import { systemClock, type Clock } from '../clock';
import { refreshSearchText } from '../enrich/search-text';
import type { EventSink } from '../events/event-sink';
import type { JobQueue } from '../jobs/job-queue';
import { PRIORITY } from '../jobs/job-types';
import { clusterFaces, type ClusterParams } from './clustering';
import { assertFacesVisible, assertPeopleVisible } from './people-access';
import type { FaceVectors } from './face-vectors';
import {
  assetsOfFaces,
  assetsOfPeople,
  listPeople,
  personFaces,
  type PersonSummary,
} from './people-queries';

const { faces, people, faceRejections } = schema;

export const CLUSTER_DEDUPE_KEY = 'cluster_faces';
export const CLUSTER_DEBOUNCE_MS = 5_000;

export interface PeopleServiceDeps {
  db: LibraryDb;
  vectors: FaceVectors;
  queue: JobQueue;
  events: EventSink;
  clusterParams(): ClusterParams;
  clock?: Clock;
}

export type MoveTarget = { personId: string } | { newPerson: true };

/**
 * People and their faces (SPEC 4.2, 8.1 #5): automatic grouping (a durable,
 * debounced `cluster_faces` job) and the user's edits: rename, merge, move faces
 * (split), "not this person" and the cover face. User edits are never undone by
 * clustering. Names are part of search, so every change refreshes search text.
 */
export class PeopleService {
  private readonly clock: Clock;

  constructor(private readonly deps: PeopleServiceDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /** Queues a clustering run a few seconds from now (repeated calls coalesce). */
  scheduleClustering(): void {
    this.deps.queue.enqueue({
      kind: 'cluster_faces',
      priority: PRIORITY.background,
      runAfter: this.clock() + CLUSTER_DEBOUNCE_MS,
      dedupeKey: CLUSTER_DEDUPE_KEY,
    });
  }

  /** The `cluster_faces` job handler. */
  readonly runClustering = async (): Promise<void> => {
    const touched = clusterFaces(
      this.deps.db,
      this.deps.vectors,
      this.deps.clusterParams(),
      this.clock(),
    );
    if (touched.length > 0) this.changed(touched);
  };

  /**
   * People the user can see, with counts from visible faces only.
   *
   * @param scope - The signed-in user's scope, or null for the whole library.
   * @returns The people.
   */
  list(scope: AccessScope | null): PersonSummary[] {
    return listPeople(this.deps.db, scope);
  }

  /**
   * One page of a person's visible faces.
   *
   * @param personId - Person id.
   * @param after - Face id to continue after, or null.
   * @param scope - The signed-in user's scope, or null for the whole library.
   * @returns Faces and the next cursor.
   */
  faces(personId: string, after: string | null, scope: AccessScope | null) {
    return personFaces(this.deps.db, personId, after, scope);
  }

  /**
   * Names a person (an empty name makes them unnamed again).
   *
   * @param personId - Person id.
   * @param name - New name.
   * @param scope - The signed-in user's scope; the person must be visible.
   */
  rename(personId: string, name: string, scope: AccessScope | null): void {
    assertPeopleVisible(this.deps.db, scope, [personId]);
    const value = name.trim() || null;
    this.deps.db.update(people).set({ name: value }).where(eq(people.id, personId)).run();
    this.changed(assetsOfPeople(this.deps.db, [personId]));
  }

  /**
   * Moves every face of one person to another and deletes the first.
   *
   * @param fromId - Person to merge away.
   * @param intoId - Person that remains.
   * @param scope - The signed-in user's scope; both people must be visible.
   */
  merge(fromId: string, intoId: string, scope: AccessScope | null): void {
    if (fromId === intoId) return;
    assertPeopleVisible(this.deps.db, scope, [fromId, intoId]);
    const affected = assetsOfPeople(this.deps.db, [fromId]);
    this.deps.db.transaction((tx) => {
      tx.update(faces).set({ personId: intoId }).where(eq(faces.personId, fromId)).run();
      tx.delete(people).where(eq(people.id, fromId)).run();
    });
    this.changed(affected);
  }

  /**
   * Moves faces to another or a new person (split). Moved faces count as the
   * user's choice and clustering never moves them again.
   *
   * @param faceIds - Faces to move.
   * @param target - Existing person or a new one.
   * @param scope - The signed-in user's scope; faces and target must be visible.
   * @returns The person the faces now belong to.
   */
  moveFaces(faceIds: readonly string[], target: MoveTarget, scope: AccessScope | null): string {
    assertFacesVisible(this.deps.db, scope, faceIds);
    if ('personId' in target) assertPeopleVisible(this.deps.db, scope, [target.personId]);
    const personId = 'personId' in target ? target.personId : this.createPerson();
    const affected = assetsOfFaces(this.deps.db, faceIds);
    this.deps.db.transaction((tx) => {
      const db = tx as unknown as LibraryDb;
      db.update(faces)
        .set({ personId, assignedBy: 'user' })
        .where(inArray(faces.id, [...faceIds]))
        .run();
      db.delete(faceRejections)
        .where(
          and(inArray(faceRejections.faceId, [...faceIds]), eq(faceRejections.personId, personId)),
        )
        .run();
    });
    this.changed(affected);
    return personId;
  }

  /**
   * "Not this person": unassigns a face and remembers the rejection, so
   * clustering never puts it back with that person.
   *
   * @param faceId - Face id.
   * @param scope - The signed-in user's scope; the face must be visible.
   */
  rejectFace(faceId: string, scope: AccessScope | null): void {
    assertFacesVisible(this.deps.db, scope, [faceId]);
    const face = this.deps.db.select().from(faces).where(eq(faces.id, faceId)).get();
    if (!face?.personId) return;
    this.deps.db.transaction((tx) => {
      tx.insert(faceRejections)
        .values({ faceId, personId: face.personId! })
        .onConflictDoNothing()
        .run();
      tx.update(faces)
        .set({ personId: null, assignedBy: 'auto' })
        .where(eq(faces.id, faceId))
        .run();
    });
    this.changed(face.assetId ? [face.assetId] : []);
  }

  /**
   * Picks the face shown for a person.
   *
   * @param personId - Person id.
   * @param faceId - One of the person's faces.
   * @param scope - The signed-in user's scope; person and face must be visible.
   */
  setCover(personId: string, faceId: string, scope: AccessScope | null): void {
    assertPeopleVisible(this.deps.db, scope, [personId]);
    assertFacesVisible(this.deps.db, scope, [faceId]);
    this.deps.db.update(people).set({ coverFaceId: faceId }).where(eq(people.id, personId)).run();
    this.deps.events.emit('people.changed', {});
  }

  /**
   * Deletes people left without faces (after purges or merges) and clears covers
   * that point at deleted faces.
   *
   * @returns How many people were deleted.
   */
  cleanup(): number {
    const { db } = this.deps;
    const removed = db.run(
      sql`DELETE FROM people WHERE id NOT IN (SELECT person_id FROM faces WHERE person_id IS NOT NULL)`,
    ).changes;
    db.run(
      sql`UPDATE people SET cover_face_id = NULL WHERE cover_face_id NOT IN (SELECT id FROM faces)`,
    );
    if (removed > 0) this.deps.events.emit('people.changed', {});
    return removed;
  }

  private createPerson(): string {
    const id = ulid(this.clock());
    this.deps.db.insert(people).values({ id, name: null, createdAt: this.clock() }).run();
    return id;
  }

  private changed(assetIds: readonly string[]): void {
    this.deps.db.transaction((tx) =>
      assetIds.forEach((id) => refreshSearchText(tx as unknown as LibraryDb, id)),
    );
    this.deps.events.emit('people.changed', {});
    this.deps.events.emit('library.changed', {});
  }
}
