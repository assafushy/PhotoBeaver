import { schema, type LibraryDb } from '@photobeaver/db';
import { and, inArray } from 'drizzle-orm';
import { scopeCondition, type AccessScope } from '../access/scope';

const { assets } = schema;
const CHUNK = 5_000;

function visibleChunk(db: LibraryDb, scope: AccessScope | null, ids: string[]): string[] {
  return db
    .select({ id: assets.id })
    .from(assets)
    .where(and(inArray(assets.id, ids), scopeCondition(scope)))
    .all()
    .map((r) => r.id);
}

/**
 * Refuses a request unless every asset exists and the user may see it, so a
 * scoped user can't change (or learn about) assets outside their scope.
 *
 * @param db - Database.
 * @param scope - The user's scope, or null for the whole library.
 * @param ids - Asset ids.
 * @throws Error 'Not found' when any id is unknown or out of scope.
 */
export function requireVisibleAssets(
  db: LibraryDb,
  scope: AccessScope | null,
  ids: readonly string[],
): void {
  const unique = [...new Set(ids)];
  const found = new Set<string>();
  for (let i = 0; i < unique.length; i += CHUNK)
    visibleChunk(db, scope, unique.slice(i, i + CHUNK)).forEach((id) => found.add(id));
  if (unique.some((id) => !found.has(id))) throw new Error('Not found');
}
