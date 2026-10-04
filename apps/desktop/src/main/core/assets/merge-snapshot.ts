import type { FaceSnapshot } from '../faces/merge-faces';
import { schema, type LibraryDb } from '@photobeaver/db';
import { eq } from 'drizzle-orm';
import { pickCapturedAt, type CapturedAt } from './capture-date';

const { albumAssets, assetTags, enrichments, assetIdentity, faces } = schema;

export type AssetRow = typeof schema.assets.$inferSelect;
type AlbumLink = typeof albumAssets.$inferSelect;
type TagLink = typeof assetTags.$inferSelect;
type EnrichmentRow = typeof enrichments.$inferSelect;
type IdentityRow = typeof assetIdentity.$inferSelect;

export const MERGEABLE_FIELDS = [
  'mime',
  'width',
  'height',
  'durationMs',
  'capturedAt',
  'capturedAtSource',
  'lat',
  'lon',
  'favorite',
  'hidden',
] as const;

export type MergeableFields = Pick<AssetRow, (typeof MERGEABLE_FIELDS)[number]>;

export interface Memberships {
  albums: AlbumLink[];
  tags: TagLink[];
  enrichments: EnrichmentRow[];
  identity: IdentityRow[];
  faceIds: string[];
}

export interface AddedToSurvivor {
  albumIds: string[];
  tagIds: string[];
  enrichmentKeys: { pluginId: string; key: string }[];
  identityKeys: { pluginId: string; key: string }[];
}

export interface MergeSnapshot {
  merged: AssetRow;
  mergedMemberships: Memberships;
  mergedFaces?: FaceSnapshot[];
  added: AddedToSurvivor;
  survivorBefore: MergeableFields;
  survivorAfter: MergeableFields;
}

/**
 * Reads everything attached to an asset that a merge moves or an unmerge restores.
 *
 * @param db - Database or transaction.
 * @param assetId - Asset id.
 * @returns Album, tag, enrichment, identity and face links.
 */
export function readMemberships(db: LibraryDb, assetId: string): Memberships {
  return {
    albums: db.select().from(albumAssets).where(eq(albumAssets.assetId, assetId)).all(),
    tags: db.select().from(assetTags).where(eq(assetTags.assetId, assetId)).all(),
    enrichments: db.select().from(enrichments).where(eq(enrichments.assetId, assetId)).all(),
    identity: db.select().from(assetIdentity).where(eq(assetIdentity.assetId, assetId)).all(),
    faceIds: db
      .select({ id: faces.id })
      .from(faces)
      .where(eq(faces.assetId, assetId))
      .all()
      .map((f) => f.id),
  };
}

/**
 * Lists what the merged asset contributes that the survivor does not already have.
 *
 * @param merged - Memberships of the merged asset.
 * @param survivor - Memberships of the survivor before the merge.
 * @returns Links that the merge adds to the survivor.
 */
export function diffAdded(merged: Memberships, survivor: Memberships): AddedToSurvivor {
  const has = <T>(rows: T[], key: (row: T) => string) => new Set(rows.map(key));
  const pk = (row: { pluginId: string; key: string }) => `${row.pluginId}\u0000${row.key}`;
  const albums = has(survivor.albums, (r) => r.albumId);
  const tags = has(survivor.tags, (r) => r.tagId);
  const enr = has(survivor.enrichments, pk);
  const ids = has(survivor.identity, pk);
  return {
    albumIds: merged.albums.map((r) => r.albumId).filter((id) => !albums.has(id)),
    tagIds: merged.tags.map((r) => r.tagId).filter((id) => !tags.has(id)),
    enrichmentKeys: merged.enrichments
      .filter((r) => !enr.has(pk(r)))
      .map(({ pluginId, key }) => ({ pluginId, key })),
    identityKeys: merged.identity
      .filter((r) => !ids.has(pk(r)))
      .map(({ pluginId, key }) => ({ pluginId, key })),
  };
}

/**
 * Picks the merge-relevant fields of an asset row.
 *
 * @param row - Asset row.
 * @returns The fields a merge may change on the survivor.
 */
export function mergeableFields(row: AssetRow): MergeableFields {
  return Object.fromEntries(MERGEABLE_FIELDS.map((f) => [f, row[f]])) as MergeableFields;
}

function capturedAtOf(row: AssetRow): CapturedAt | null {
  return row.capturedAt === null || !row.capturedAtSource
    ? null
    : { value: row.capturedAt, source: row.capturedAtSource };
}

/**
 * Survivor fields after a merge: gaps filled from the merged asset, capture time
 * by core-field precedence (survivor wins ties), and favorite/hidden kept if
 * either asset had them.
 *
 * @param survivor - Survivor row.
 * @param merged - Merged row.
 * @returns The new field values.
 */
export function combinedFields(survivor: AssetRow, merged: AssetRow): MergeableFields {
  const out = mergeableFields(survivor);
  for (const field of MERGEABLE_FIELDS) {
    if (out[field] === null || out[field] === undefined)
      (out as Record<string, unknown>)[field] = merged[field];
  }
  const captured = pickCapturedAt(capturedAtOf(merged), capturedAtOf(survivor));
  out.capturedAt = captured?.value ?? out.capturedAt;
  out.capturedAtSource = captured?.source ?? out.capturedAtSource;
  out.favorite = Math.max(survivor.favorite ?? 0, merged.favorite ?? 0);
  out.hidden = Math.max(survivor.hidden ?? 0, merged.hidden ?? 0);
  return out;
}
