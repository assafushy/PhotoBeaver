import { schema, type LibraryDb } from '@photobeaver/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import { captureDateFromItem, pickCapturedAt, type CapturedAt } from './capture-date';

const { assets, assetTags, instances, tags } = schema;

function userTagId(db: LibraryDb, name: string): string | null {
  const row = db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.name, name), eq(tags.kind, 'user')))
    .get();
  return row?.id ?? null;
}

function ensureUserTag(db: LibraryDb, name: string, now: number): string {
  const existing = userTagId(db, name);
  if (existing) return existing;
  const id = ulid(now);
  db.insert(tags).values({ id, name, kind: 'user' }).run();
  return id;
}

/**
 * Adds a user tag to assets, reusing the tag row with the same name.
 *
 * @param db - Database or transaction.
 * @param ids - Asset ids.
 * @param name - Tag name.
 * @param now - Current time (for the new tag id).
 */
export function addUserTag(db: LibraryDb, ids: readonly string[], name: string, now: number): void {
  const tagId = ensureUserTag(db, name, now);
  for (const assetId of ids)
    db.insert(assetTags).values({ assetId, tagId, pluginId: null }).onConflictDoNothing().run();
}

/**
 * Removes a user tag from assets, and deletes the tag once nothing uses it.
 *
 * @param db - Database or transaction.
 * @param ids - Asset ids.
 * @param name - Tag name.
 */
export function removeUserTag(db: LibraryDb, ids: readonly string[], name: string): void {
  const tagId = userTagId(db, name);
  if (!tagId) return;
  db.delete(assetTags)
    .where(and(eq(assetTags.tagId, tagId), inArray(assetTags.assetId, [...ids])))
    .run();
  const used = db.select().from(assetTags).where(eq(assetTags.tagId, tagId)).get();
  if (!used) db.delete(tags).where(eq(tags.id, tagId)).run();
}

function instanceCapture(row: {
  meta: string | null;
  modifiedAt: number | null;
}): CapturedAt | null {
  const meta = (row.meta ? JSON.parse(row.meta) : {}) as { filename?: string };
  const modifiedAt = row.modifiedAt === null ? undefined : new Date(row.modifiedAt).toISOString();
  return captureDateFromItem({ filename: meta.filename, modifiedAt });
}

/**
 * The capture time an asset falls back to when the user clears their date:
 * the best filename or modified time among its live instances. Enrichment is
 * planned again afterwards, so EXIF dates come back on their own.
 *
 * @param db - Database or transaction.
 * @param assetId - Asset id.
 * @returns The fallback, or null.
 */
export function fallbackCapture(db: LibraryDb, assetId: string): CapturedAt | null {
  return db
    .select({ meta: instances.sourceMetadataJson, modifiedAt: instances.sourceModifiedAt })
    .from(instances)
    .where(and(eq(instances.assetId, assetId), isNull(instances.deletedAt)))
    .all()
    .reduce<CapturedAt | null>((best, row) => pickCapturedAt(best, instanceCapture(row)), null);
}

/**
 * Whether the asset's date or location currently comes from the user.
 *
 * @param db - Database or transaction.
 * @param assetId - Asset id.
 * @returns Which fields the user set.
 */
export function userFields(db: LibraryDb, assetId: string): { date: boolean; location: boolean } {
  const row = db
    .select({ date: assets.capturedAtSource, location: assets.locationSource })
    .from(assets)
    .where(eq(assets.id, assetId))
    .get();
  return { date: row?.date === 'user', location: row?.location === 'user' };
}
