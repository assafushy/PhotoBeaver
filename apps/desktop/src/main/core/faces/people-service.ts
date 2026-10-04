import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { systemClock, type Clock } from '../clock';
import { refreshSearchText } from '../enrich/search-text';
import type { EventSink } from '../events/event-sink';
import type { JobQueue } from '../jobs/job-queue';
import { PRIORITY } from '../jobs/job-types';
import { clusterFaces, type ClusterParams } from './clustering';
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

  list(): PersonSummary[] {
    return listPeople(this.deps.db);
  }

  faces(personId: string, after: string | null) {
    return personFaces(this.deps.db, personId, after);
  }

  /**
   * Names a person (an empty name makes them unnamed again).
   *
   * @param personId - Person id.
   * @param name - New name.
   */
  rename(personId: string, name: string): void {
    const value = name.trim() || null;
    this.deps.db.update(people).set({ name: value }).where(eq(people.id, personId)).run();
    this.changed(assetsOfPeople(this.deps.db, [personId]));
  }

  /**
   * Moves every face of one person to another and deletes the first.
   *
   * @param fromId - Person to merge away.
   * @param intoId - Person that remains.
   */
  merge(fromId: string, intoId: string): void {
    if (fromId === intoId) return;
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
   * @returns The person the faces now belong to.
   */
  moveFaces(faceIds: readonly string[], target: MoveTarget): string {
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
   */
  rejectFace(faceId: string): void {
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
   */
  setCover(personId: string, faceId: string): void {
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
