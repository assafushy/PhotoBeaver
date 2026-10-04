import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { FaceVectors } from './face-vectors';
import { matchBoxes, type Box } from './geometry';

const { faces } = schema;

export const FACE_MATCH_IOU = 0.5;

export interface DetectedFace {
  bbox: Box;
  confidence: number;
  embedding?: number[];
}

type FaceRow = typeof faces.$inferSelect;

export interface FaceSyncResult {
  added: string[];
  kept: string[];
  removed: string[];
}

const boxOf = (row: FaceRow): Box => JSON.parse(row.bboxJson ?? '{"x":0,"y":0,"w":0,"h":0}') as Box;

function priority(row: FaceRow): number {
  if (row.assignedBy === 'user') return 0;
  return row.personId ? 1 : 2;
}

function existingFaces(db: LibraryDb, assetId: string, pluginId: string): FaceRow[] {
  return db
    .select()
    .from(faces)
    .where(and(eq(faces.assetId, assetId), eq(faces.pluginId, pluginId)))
    .all()
    .sort((a, b) => priority(a) - priority(b));
}

/**
 * Stores an enricher's faces for one asset, keeping face ids stable across re-runs:
 * a detected face that overlaps an existing one (IoU at least 0.5) keeps its id,
 * person and how it was assigned, so naming people and fixing clusters survive
 * "Re-run". Faces no longer detected are deleted with their embeddings.
 */
export class FaceStore {
  constructor(readonly vectors: FaceVectors) {}

  /**
   * Replaces one plugin's faces on an asset.
   *
   * @param db - Database or transaction (same connection as the vectors).
   * @param target - Asset and plugin.
   * @param detected - Faces from the enrichment result.
   * @returns Which face ids were added, kept and removed.
   */
  sync(
    db: LibraryDb,
    target: { assetId: string; pluginId: string },
    detected: DetectedFace[],
  ): FaceSyncResult {
    const existing = existingFaces(db, target.assetId, target.pluginId);
    const matches = matchBoxes(
      detected.map((f) => f.bbox),
      existing.map(boxOf),
      FACE_MATCH_IOU,
    );
    const result: FaceSyncResult = { added: [], kept: [], removed: [] };
    detected.forEach((face, index) => {
      const match = existing[matches[index]!];
      if (match) result.kept.push(this.update(db, match.id, face));
      else result.added.push(this.insert(db, target, face));
    });
    const kept = new Set(result.kept);
    result.removed = existing.filter((row) => !kept.has(row.id)).map((row) => row.id);
    this.remove(db, result.removed);
    return result;
  }

  /**
   * Deletes faces and their embeddings.
   *
   * @param db - Database or transaction.
   * @param faceIds - Face ids.
   */
  remove(db: LibraryDb, faceIds: readonly string[]): void {
    for (const id of faceIds) db.delete(faces).where(eq(faces.id, id)).run();
    this.vectors.delete(faceIds);
  }

  private update(db: LibraryDb, id: string, face: DetectedFace): string {
    db.update(faces)
      .set({ bboxJson: JSON.stringify(face.bbox), confidence: face.confidence })
      .where(eq(faces.id, id))
      .run();
    this.storeVector(id, face);
    return id;
  }

  private insert(
    db: LibraryDb,
    target: { assetId: string; pluginId: string },
    face: DetectedFace,
  ): string {
    const id = ulid();
    db.insert(faces)
      .values({
        id,
        ...target,
        bboxJson: JSON.stringify(face.bbox),
        confidence: face.confidence,
        assignedBy: 'auto',
      })
      .run();
    this.storeVector(id, face);
    return id;
  }

  private storeVector(id: string, face: DetectedFace): void {
    if (face.embedding) this.vectors.write(id, face.embedding);
    else this.vectors.delete([id]);
  }
}
