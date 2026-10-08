import { schema, type LibraryDb } from '@photobeaver/db';
import type { IpcParsedInput, LibraryFilter, LibraryPage } from '@photobeaver/shared';
import { and, count, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { AccessScope } from '../core/access/scope';
import { filterCondition } from './library-filter';

type LibraryQuery = Omit<IpcParsedInput<'library.query'>, 'filter'> & { filter?: LibraryFilter };
type Cursor = NonNullable<LibraryQuery['cursor']>;

const { assets } = schema;
const sortTime = schema.librarySortExpression;

function afterCursor(cursor: Cursor): SQL | undefined {
  return or(
    lt(sortTime, cursor.capturedAt),
    and(eq(sortTime, cursor.capturedAt), lt(assets.id, cursor.id)),
  );
}

function fetchRows(db: LibraryDb, query: LibraryQuery, scope: AccessScope | null) {
  const visible = filterCondition(query.filter ?? {}, scope);
  const where = query.cursor ? and(visible, afterCursor(query.cursor)) : visible;
  return db
    .select({
      id: assets.id,
      mediaType: assets.mediaType,
      capturedAt: assets.capturedAt,
      width: assets.width,
      height: assets.height,
      thumbState: assets.thumbState,
      sortTime,
    })
    .from(assets)
    .where(where)
    .orderBy(desc(sortTime), desc(assets.id))
    .limit(query.limit + 1)
    .all();
}

function countVisible(db: LibraryDb, query: LibraryQuery, scope: AccessScope | null): number {
  return (
    db
      .select({ n: count() })
      .from(assets)
      .where(filterCondition(query.filter ?? {}, scope))
      .get()?.n ?? 0
  );
}

/**
 * Returns one keyset-paginated page of the library, newest first (SPEC 8.3).
 *
 * @param db - The library database.
 * @param query - Cursor and page size.
 * @param scope - The signed-in user's scope, or null for the whole library.
 * @returns The page items, the cursor for the next page, and the total count.
 */
export function queryLibraryPage(
  db: LibraryDb,
  query: LibraryQuery,
  scope: AccessScope | null,
): LibraryPage {
  const rows = fetchRows(db, query, scope);
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(({ sortTime: _sortTime, ...item }) => item),
    nextCursor: hasMore && last ? { capturedAt: last.sortTime, id: last.id } : null,
    total: countVisible(db, query, scope),
  };
}
