import { schema, type LibraryDb } from '@photobeaver/db';
import type { DuplicateSuggestion, IdentityPage } from '@photobeaver/plugin-sdk';
import { and, eq, gt, inArray, like, ne, or, asc } from 'drizzle-orm';
import { ulid } from 'ulid';

const { assetIdentity, duplicateSuggestions } = schema;
const PAGE_SIZE = 1000;

/**
 * Assets (excluding one) that hold any of the given identity keys (SPEC 6.4).
 *
 * @param db - Library database.
 * @param keys - Identity keys.
 * @param excludeAssetId - Asset to leave out (usually the one being enriched).
 * @returns Asset ids per key; keys without matches are omitted.
 */
export function findByIdentity(
  db: LibraryDb,
  keys: readonly string[],
  excludeAssetId?: string,
): Record<string, string[]> {
  if (keys.length === 0) return {};
  const where = excludeAssetId
    ? and(inArray(assetIdentity.key, [...keys]), ne(assetIdentity.assetId, excludeAssetId))
    : inArray(assetIdentity.key, [...keys]);
  const out: Record<string, string[]> = {};
  for (const row of db
    .selectDistinct({ key: assetIdentity.key, assetId: assetIdentity.assetId })
    .from(assetIdentity)
    .where(where)
    .all()) {
    (out[row.key] ??= []).push(row.assetId);
  }
  return out;
}

function decodeCursor(cursor?: string): { key: string; assetId: string } | null {
  if (!cursor) return null;
  const [key, assetId] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [
    string,
    string,
  ];
  return { key, assetId };
}

function encodeCursor(row: { key: string; assetId: string }): string {
  return Buffer.from(JSON.stringify([row.key, row.assetId])).toString('base64url');
}

/**
 * Pages through identity keys with a prefix, for near-duplicate scans in `finalize`.
 *
 * @param db - Library database.
 * @param prefix - Key prefix such as `phash:`.
 * @param cursor - Opaque cursor from the previous page.
 * @returns Items and the next cursor.
 */
export function listIdentity(db: LibraryDb, prefix: string, cursor?: string): IdentityPage {
  const after = decodeCursor(cursor);
  const position = after
    ? or(
        gt(assetIdentity.key, after.key),
        and(eq(assetIdentity.key, after.key), gt(assetIdentity.assetId, after.assetId)),
      )
    : undefined;
  const rows = db
    .selectDistinct({ key: assetIdentity.key, assetId: assetIdentity.assetId })
    .from(assetIdentity)
    .where(and(like(assetIdentity.key, `${prefix.replace(/[%_]/g, '')}%`), position))
    .orderBy(asc(assetIdentity.key), asc(assetIdentity.assetId))
    .limit(PAGE_SIZE)
    .all();
  return {
    items: rows,
    cursor: rows.length === PAGE_SIZE ? encodeCursor(rows.at(-1)!) : undefined,
  };
}

const setKey = (ids: readonly string[]): string => JSON.stringify([...new Set(ids)].sort());

function suggestedSets(db: LibraryDb): Set<string> {
  return new Set(
    db
      .select({ ids: duplicateSuggestions.assetIdsJson })
      .from(duplicateSuggestions)
      .all()
      .map((r) => r.ids),
  );
}

interface NewSuggestion {
  pluginId: string;
  ids: string;
  suggestion: DuplicateSuggestion;
  now: number;
}

function insertSuggestion(db: LibraryDb, { pluginId, ids, suggestion, now }: NewSuggestion): void {
  db.insert(duplicateSuggestions)
    .values({
      id: ulid(now),
      pluginId,
      assetIdsJson: ids,
      kind: suggestion.kind,
      confidence: suggestion.confidence,
      createdAt: now,
    })
    .run();
}

/**
 * Stores duplicate suggestions for the user (SPEC 4.3 step 3), skipping sets that
 * were already suggested (open, merged or dismissed).
 *
 * @param db - Library database.
 * @param pluginId - Suggesting plugin.
 * @param suggestions - Suggested sets.
 * @param now - Current time.
 * @returns Number of new suggestions.
 */
export function storeSuggestions(
  db: LibraryDb,
  pluginId: string,
  suggestions: readonly DuplicateSuggestion[],
  now: number,
): number {
  const existing = suggestedSets(db);
  let added = 0;
  for (const suggestion of suggestions) {
    const ids = setKey(suggestion.assetIds);
    if (existing.has(ids) || JSON.parse(ids).length < 2) continue;
    insertSuggestion(db, { pluginId, ids, suggestion, now });
    existing.add(ids);
    added++;
  }
  return added;
}
