import { schema, type LibraryDb } from '@photobeaver/db';
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gt,
  inArray,
  isNotNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import { scopeCondition, type AccessScope } from '../access/scope';

const { faces, people } = schema;

export interface PersonSummary {
  id: string;
  name: string | null;
  faceCount: number;
  assetCount: number;
  coverFaceId: string | null;
}

export interface PersonFace {
  id: string;
  assetId: string;
  bbox: { x: number; y: number; w: number; h: number };
  assignedBy: 'user' | 'auto';
}

const FACE_PAGE = 200;

function compareSummaries(a: PersonSummary, b: PersonSummary): number {
  if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1;
  if (a.name && b.name) return a.name.localeCompare(b.name);
  return b.faceCount - a.faceCount;
}

/**
 * SQL that keeps only faces on assets the user may see.
 *
 * @param scope - The user's scope, or null for everything.
 * @returns The condition, or undefined when the user is not scoped.
 */
export const visibleFace = (scope: AccessScope | null): SQL | undefined =>
  scopeCondition(scope, sql`${faces.assetId}`);

function selectPeopleRows(db: LibraryDb, scope: AccessScope | null) {
  return db
    .select({
      id: people.id,
      name: people.name,
      cover: people.coverFaceId,
      coverListed: sql<number>`max(${faces.id} = ${people.coverFaceId})`,
      faceCount: count(faces.id),
      assetCount: countDistinct(faces.assetId),
      firstFace: sql<string>`min(${faces.id})`,
    })
    .from(people)
    .innerJoin(faces, eq(faces.personId, people.id))
    .where(visibleFace(scope))
    .groupBy(people.id)
    .all();
}

/**
 * People with their face and photo counts: named people by name, then unnamed
 * clusters, largest first. Only faces on assets the user can see are counted,
 * people with none are left out, and a cover the user cannot see falls back to
 * their first visible face.
 *
 * @param db - Database.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns The people.
 */
export function listPeople(db: LibraryDb, scope: AccessScope | null): PersonSummary[] {
  return selectPeopleRows(db, scope)
    .map((r) => ({
      id: r.id,
      name: r.name,
      faceCount: r.faceCount,
      assetCount: r.assetCount,
      coverFaceId: r.cover && (r.coverListed === 1 || !scope) ? r.cover : r.firstFace,
    }))
    .sort(compareSummaries);
}

/**
 * One page of a person's faces, only those on assets the user can see.
 *
 * @param db - Database.
 * @param personId - Person id.
 * @param after - Face id to continue after, or null for the first page.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns Faces in id order and the cursor for the next page.
 */
export function personFaces(
  db: LibraryDb,
  personId: string,
  after: string | null,
  scope: AccessScope | null,
) {
  const where = and(
    eq(faces.personId, personId),
    isNotNull(faces.assetId),
    after ? gt(faces.id, after) : undefined,
    visibleFace(scope),
  );
  const rows = db
    .select()
    .from(faces)
    .where(where)
    .orderBy(asc(faces.id))
    .limit(FACE_PAGE + 1)
    .all();
  const items: PersonFace[] = rows.slice(0, FACE_PAGE).map((row) => ({
    id: row.id,
    assetId: row.assetId!,
    bbox: JSON.parse(row.bboxJson ?? '{}') as PersonFace['bbox'],
    assignedBy: row.assignedBy ?? 'auto',
  }));
  return { items, nextCursor: rows.length > FACE_PAGE ? items.at(-1)!.id : null };
}

/**
 * Assets that show any of the given people (for refreshing search text).
 *
 * @param db - Database.
 * @param personIds - People.
 * @returns Asset ids.
 */
export function assetsOfPeople(db: LibraryDb, personIds: readonly string[]): string[] {
  if (personIds.length === 0) return [];
  return db
    .selectDistinct({ assetId: faces.assetId })
    .from(faces)
    .where(inArray(faces.personId, [...personIds]))
    .all()
    .flatMap((r) => (r.assetId ? [r.assetId] : []));
}

/**
 * Assets of the given faces.
 *
 * @param db - Database.
 * @param faceIds - Faces.
 * @returns Asset ids.
 */
export function assetsOfFaces(db: LibraryDb, faceIds: readonly string[]): string[] {
  if (faceIds.length === 0) return [];
  return db
    .selectDistinct({ assetId: faces.assetId })
    .from(faces)
    .where(inArray(faces.id, [...faceIds]))
    .all()
    .flatMap((r) => (r.assetId ? [r.assetId] : []));
}
