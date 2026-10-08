import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { AccessScope } from '../access/scope';
import { visibleFace } from './people-queries';

const { faces } = schema;

/**
 * Refuses faces that are not on an asset the user can see (SPEC 3.3).
 *
 * @param db - Database.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @param faceIds - Faces the user wants to change.
 * @throws Error when any face is missing or out of scope.
 */
export function assertFacesVisible(
  db: LibraryDb,
  scope: AccessScope | null,
  faceIds: readonly string[],
): void {
  if (!scope || faceIds.length === 0) return;
  const unique = [...new Set(faceIds)];
  const found = db
    .select({ id: faces.id })
    .from(faces)
    .where(and(inArray(faces.id, unique), visibleFace(scope)))
    .all();
  if (found.length !== unique.length) throw new Error('Face not found');
}

/**
 * Refuses people the user cannot see: those without a face on a visible asset.
 *
 * @param db - Database.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @param personIds - People the user wants to change.
 * @throws Error when any person has no visible face.
 */
export function assertPeopleVisible(
  db: LibraryDb,
  scope: AccessScope | null,
  personIds: readonly string[],
): void {
  if (!scope) return;
  for (const personId of personIds) {
    const face = db
      .select({ id: faces.id })
      .from(faces)
      .where(and(eq(faces.personId, personId), visibleFace(scope)))
      .get();
    if (!face) throw new Error('Person not found');
  }
}
