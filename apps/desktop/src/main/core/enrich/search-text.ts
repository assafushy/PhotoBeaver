import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, sql } from 'drizzle-orm';

const { instances, assetTags, tags, enrichments } = schema;

export const SEARCH_TEXT_KEY = '$searchText';

function instanceTerms(db: LibraryDb, assetId: string): string[] {
  const rows = db
    .select({ path: instances.path, meta: instances.sourceMetadataJson })
    .from(instances)
    .where(eq(instances.assetId, assetId))
    .all();
  return rows.flatMap((row) => {
    const meta = (row.meta ? JSON.parse(row.meta) : {}) as { filename?: string; caption?: string };
    return [meta.filename, meta.caption, row.path].filter((v): v is string => Boolean(v));
  });
}

function tagTerms(db: LibraryDb, assetId: string): string[] {
  return db
    .select({ name: tags.name })
    .from(assetTags)
    .innerJoin(tags, eq(tags.id, assetTags.tagId))
    .where(eq(assetTags.assetId, assetId))
    .all()
    .map((r) => r.name);
}

function enricherTerms(db: LibraryDb, assetId: string): string[] {
  return db
    .select({ value: enrichments.valueJson })
    .from(enrichments)
    .where(and(eq(enrichments.assetId, assetId), eq(enrichments.key, SEARCH_TEXT_KEY)))
    .all()
    .map((r) => JSON.parse(r.value) as string);
}

/**
 * Rebuilds an asset's full-text row (SPEC 4.2 `assets_fts`) from file names,
 * folders, captions, tags and place names, and enricher `searchText`.
 *
 * @param db - Database or transaction.
 * @param assetId - Asset id.
 */
export function refreshSearchText(db: LibraryDb, assetId: string): void {
  const text = [
    ...instanceTerms(db, assetId),
    ...tagTerms(db, assetId),
    ...enricherTerms(db, assetId),
  ]
    .join(' ')
    .replace(/[_\-./\\]+/g, ' ');
  db.run(sql`DELETE FROM assets_fts WHERE asset_id = ${assetId}`);
  if (text.trim())
    db.run(sql`INSERT INTO assets_fts (asset_id, text) VALUES (${assetId}, ${text})`);
}

/**
 * Deletes an asset's full-text row (merged or purged assets).
 *
 * @param db - Database or transaction.
 * @param assetId - Asset id.
 */
export function removeSearchText(db: LibraryDb, assetId: string): void {
  db.run(sql`DELETE FROM assets_fts WHERE asset_id = ${assetId}`);
}
