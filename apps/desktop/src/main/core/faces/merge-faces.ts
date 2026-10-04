import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FaceStore } from './face-store';
import { iou, type Box } from './geometry';

const { faces, people } = schema;

type FaceRow = typeof faces.$inferSelect;

export interface FaceSnapshot {
  row: FaceRow;
  embedding: number[] | null;
}

const boxOf = (row: FaceRow): Box => JSON.parse(row.bboxJson ?? '{"x":0,"y":0,"w":0,"h":0}') as Box;

/**
 * Every face of an asset with its embedding, for the merge snapshot.
 *
 * @param db - Database or transaction.
 * @param store - Face store.
 * @param assetId - Asset id.
 * @returns Face rows and embeddings.
 */
export function snapshotFaces(db: LibraryDb, store: FaceStore, assetId: string): FaceSnapshot[] {
  return db
    .select()
    .from(faces)
    .where(eq(faces.assetId, assetId))
    .all()
    .map((row) => ({ row, embedding: store.vectors.read(row.id) }));
}

function inheritPerson(db: LibraryDb, from: FaceRow, survivorFaces: FaceRow[]): void {
  const target = survivorFaces.find(
    (face) => !face.personId && face.assignedBy !== 'user' && iou(boxOf(face), boxOf(from)) >= 0.5,
  );
  if (!target || !from.personId) return;
  db.update(faces)
    .set({ personId: from.personId, assignedBy: from.assignedBy })
    .where(eq(faces.id, target.id))
    .run();
  target.personId = from.personId;
}

function survivorFacesOf(db: LibraryDb, survivorId: string, pluginId: string | null): FaceRow[] {
  const plugin = pluginId === null ? isNull(faces.pluginId) : eq(faces.pluginId, pluginId);
  return db
    .select()
    .from(faces)
    .where(and(eq(faces.assetId, survivorId), plugin))
    .all();
}

/**
 * Moves the merged asset's faces to the survivor. When the survivor already has
 * faces from the same plugin (both are the same photo), the merged copies are
 * dropped instead of doubled, and their people pass to the matching survivor
 * faces. The merge snapshot keeps the dropped faces, so undo restores them.
 *
 * @param db - Transaction.
 * @param store - Face store.
 * @param mergedId - Asset being merged away.
 * @param survivorId - Asset that remains.
 */
export function moveFacesOnMerge(
  db: LibraryDb,
  store: FaceStore,
  mergedId: string,
  survivorId: string,
): void {
  for (const face of db.select().from(faces).where(eq(faces.assetId, mergedId)).all()) {
    const existing = survivorFacesOf(db, survivorId, face.pluginId);
    if (existing.length === 0) {
      db.update(faces).set({ assetId: survivorId }).where(eq(faces.id, face.id)).run();
      continue;
    }
    inheritPerson(db, face, existing);
    store.remove(db, [face.id]);
  }
}

function personExists(db: LibraryDb, personId: string | null): boolean {
  return (
    personId !== null &&
    db.select({ id: people.id }).from(people).where(eq(people.id, personId)).get() !== undefined
  );
}

function restoreFace(db: LibraryDb, store: FaceStore, saved: FaceSnapshot, mergedId: string): void {
  const exists = db.select({ id: faces.id }).from(faces).where(eq(faces.id, saved.row.id)).get();
  if (exists) {
    db.update(faces).set({ assetId: mergedId }).where(eq(faces.id, saved.row.id)).run();
    return;
  }
  const personId = personExists(db, saved.row.personId) ? saved.row.personId : null;
  db.insert(faces)
    .values({ ...saved.row, assetId: mergedId, personId })
    .run();
  if (saved.embedding) store.vectors.write(saved.row.id, saved.embedding);
}

/**
 * Gives the restored asset its faces back on undo, from the merge snapshot:
 * faces still on the survivor move back; dropped duplicates are re-created with
 * their embeddings and people (when the person still exists).
 *
 * @param db - Transaction.
 * @param store - Face store.
 * @param saved - Faces from the snapshot.
 * @param mergedId - The restored asset.
 */
export function restoreFacesOnUnmerge(
  db: LibraryDb,
  store: FaceStore,
  saved: FaceSnapshot[],
  mergedId: string,
): void {
  for (const face of saved) restoreFace(db, store, face, mergedId);
}
