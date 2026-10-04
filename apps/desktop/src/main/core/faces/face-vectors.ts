import type Database from 'better-sqlite3';

export const FACE_DIMENSIONS = 512;

export interface Neighbour {
  faceId: string;
  distance: number;
}

/**
 * The `faces_vec` table (sqlite-vec): one 512-d embedding per face. Virtual tables
 * have no foreign keys, so callers delete vectors when they delete faces, and
 * `pruneOrphans` sweeps any left over.
 */
export class FaceVectors {
  constructor(private readonly sqlite: Database.Database) {}

  /**
   * Stores (or replaces) a face's embedding.
   *
   * @param faceId - Face id.
   * @param embedding - 512 numbers.
   */
  write(faceId: string, embedding: readonly number[]): void {
    this.delete([faceId]);
    this.sqlite
      .prepare('INSERT INTO faces_vec (face_id, embedding) VALUES (?, ?)')
      .run(faceId, Float32Array.from(embedding));
  }

  /**
   * Reads a face's embedding.
   *
   * @param faceId - Face id.
   * @returns The embedding, or null when the face has none.
   */
  read(faceId: string): number[] | null {
    const row = this.sqlite
      .prepare('SELECT embedding FROM faces_vec WHERE face_id = ?')
      .get(faceId) as { embedding: Buffer } | undefined;
    if (!row) return null;
    const bytes = row.embedding;
    return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
  }

  /**
   * Deletes embeddings.
   *
   * @param faceIds - Face ids.
   */
  delete(faceIds: readonly string[]): void {
    const statement = this.sqlite.prepare('DELETE FROM faces_vec WHERE face_id = ?');
    for (const id of faceIds) statement.run(id);
  }

  /**
   * Nearest faces by cosine distance.
   *
   * @param embedding - Query embedding.
   * @param k - How many neighbours.
   * @returns Neighbours, closest first (may include the query face itself).
   */
  nearest(embedding: readonly number[], k: number): Neighbour[] {
    const rows = this.sqlite
      .prepare(
        'SELECT face_id, distance FROM faces_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance',
      )
      .all(Float32Array.from(embedding), k) as { face_id: string; distance: number }[];
    return rows.map((row) => ({ faceId: row.face_id, distance: row.distance }));
  }

  /**
   * Deletes embeddings whose face no longer exists (after cascading deletes).
   *
   * @returns How many were removed.
   */
  pruneOrphans(): number {
    const orphans = this.sqlite
      .prepare('SELECT face_id FROM faces_vec WHERE face_id NOT IN (SELECT id FROM faces)')
      .all() as { face_id: string }[];
    this.delete(orphans.map((row) => row.face_id));
    return orphans.length;
  }
}
