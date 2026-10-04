import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { FaceVectors, Neighbour } from './face-vectors';

const { faces, people, faceRejections } = schema;

export interface ClusterParams {
  maxDistance: number;
  minFaces: number;
}

export const DEFAULT_CLUSTER_PARAMS: ClusterParams = { maxDistance: 0.5, minFaces: 3 };

const NEIGHBOURS = 16;
const CHUNK = 500;

interface ClusterContext {
  db: LibraryDb;
  vectors: FaceVectors;
  params: ClusterParams;
  now: number;
  touched: Set<string>;
}

function unassignedFaces(db: LibraryDb, afterId: string, limit: number) {
  return db
    .select({ id: faces.id, assetId: faces.assetId })
    .from(faces)
    .where(and(isNull(faces.personId), eq(faces.assignedBy, 'auto'), sql`${faces.id} > ${afterId}`))
    .orderBy(faces.id)
    .limit(limit)
    .all();
}

function closeNeighbours(ctx: ClusterContext, faceId: string): Neighbour[] {
  const embedding = ctx.vectors.read(faceId);
  if (!embedding) return [];
  return ctx.vectors
    .nearest(embedding, NEIGHBOURS)
    .filter((n) => n.faceId !== faceId && n.distance <= ctx.params.maxDistance);
}

function rejectedPeople(db: LibraryDb, faceId: string): Set<string> {
  const rows = db.select().from(faceRejections).where(eq(faceRejections.faceId, faceId)).all();
  return new Set(rows.map((row) => row.personId));
}

interface NeighbourOwners {
  person: string | null;
  unassigned: number;
}

function ownersOf(ctx: ClusterContext, neighbours: Neighbour[]): Map<string, string | null> {
  if (neighbours.length === 0) return new Map();
  const rows = ctx.db
    .select({ id: faces.id, personId: faces.personId })
    .from(faces)
    .where(
      inArray(
        faces.id,
        neighbours.map((n) => n.faceId),
      ),
    )
    .all();
  return new Map(rows.map((row) => [row.id, row.personId]));
}

function neighbourOwners(
  ctx: ClusterContext,
  faceId: string,
  neighbours: Neighbour[],
): NeighbourOwners {
  const personOf = ownersOf(ctx, neighbours);
  const rejected = rejectedPeople(ctx.db, faceId);
  const unassigned = neighbours.filter((n) => personOf.get(n.faceId) === null).length;
  const owner = neighbours.find((n) => {
    const person = personOf.get(n.faceId);
    return Boolean(person && !rejected.has(person));
  });
  return { person: owner ? personOf.get(owner.faceId)! : null, unassigned };
}

function assign(
  ctx: ClusterContext,
  face: { id: string; assetId: string | null },
  personId: string,
): void {
  ctx.db.update(faces).set({ personId, assignedBy: 'auto' }).where(eq(faces.id, face.id)).run();
  if (face.assetId) ctx.touched.add(face.assetId);
}

function startPerson(ctx: ClusterContext, face: { id: string; assetId: string | null }): void {
  const id = ulid(ctx.now);
  ctx.db.insert(people).values({ id, name: null, coverFaceId: face.id, createdAt: ctx.now }).run();
  assign(ctx, face, id);
}

function placeFace(
  ctx: ClusterContext,
  face: { id: string; assetId: string | null },
  allowNew: boolean,
): boolean {
  const owners = neighbourOwners(ctx, face.id, closeNeighbours(ctx, face.id));
  if (owners.person) return (assign(ctx, face, owners.person), true);
  if (!allowNew || owners.unassigned + 1 < ctx.params.minFaces) return false;
  startPerson(ctx, face);
  return true;
}

function pass(ctx: ClusterContext, allowNew: boolean): number {
  let placed = 0;
  let after = '';
  for (;;) {
    const chunk = unassignedFaces(ctx.db, after, CHUNK);
    if (chunk.length === 0) return placed;
    ctx.db.transaction(() =>
      chunk.forEach((face) => (placed += placeFace(ctx, face, allowNew) ? 1 : 0)),
    );
    after = chunk.at(-1)!.id;
  }
}

/**
 * Groups unassigned faces into people (incremental, like Immich): a face joins the
 * person of its nearest assigned neighbour within `maxDistance` unless the user
 * rejected that pairing; a face with at least `minFaces - 1` close unassigned
 * neighbours starts a new unnamed person; the rest wait for more photos. Faces a user
 * assigned or unassigned by hand are never touched.
 *
 * @param db - Database.
 * @param vectors - Face embeddings.
 * @param params - Distance threshold and minimum faces per person.
 * @param now - Current time.
 * @returns Assets whose faces changed person.
 */
export function clusterFaces(
  db: LibraryDb,
  vectors: FaceVectors,
  params: ClusterParams,
  now: number,
): string[] {
  const ctx: ClusterContext = { db, vectors, params, now, touched: new Set() };
  pass(ctx, true);
  pass(ctx, false);
  return [...ctx.touched];
}
