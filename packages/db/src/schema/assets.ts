import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const UNDATED_SORT_VALUE = Number.MIN_SAFE_INTEGER;

export const librarySortExpression = sql<number>`${sql.raw(
  `COALESCE("assets"."captured_at", ${UNDATED_SORT_VALUE})`,
)}`;

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    mediaType: text('media_type', { enum: ['image', 'video'] }).notNull(),
    mime: text('mime'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    capturedAt: integer('captured_at'),
    capturedAtSource: text('captured_at_source', {
      enum: ['user', 'exif', 'source', 'enricher', 'filename', 'mtime'],
    }),
    lat: real('lat'),
    lon: real('lon'),
    locationSource: text('location_source', { enum: ['user', 'exif', 'source', 'enricher'] }),
    favorite: integer('favorite').default(0),
    hidden: integer('hidden').default(0),
    thumbState: text('thumb_state', { enum: ['pending', 'ready', 'failed'] }).default('pending'),
    missingSince: integer('missing_since'),
    createdAt: integer('created_at'),
    updatedAt: integer('updated_at'),
  },
  (t) => [
    index('assets_captured_at_idx').on(t.capturedAt, t.id),
    index('assets_lat_lon_idx').on(t.lat, t.lon),
    index('assets_media_type_idx').on(t.mediaType),
  ],
);

export const enrichments = sqliteTable(
  'enrichments',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id').notNull(),
    pluginVersion: text('plugin_version').notNull(),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    createdAt: integer('created_at'),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.pluginId, t.key] })],
);

export const assetIdentity = sqliteTable(
  'asset_identity',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id').notNull(),
    key: text('key').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.pluginId, t.key] }),
    index('asset_identity_key_idx').on(t.key),
  ],
);

export const duplicateSuggestions = sqliteTable(
  'duplicate_suggestions',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').notNull(),
    assetIdsJson: text('asset_ids_json').notNull(),
    kind: text('kind', { enum: ['exact', 'near'] }).notNull(),
    confidence: real('confidence'),
    status: text('status', { enum: ['open', 'merged', 'dismissed'] })
      .notNull()
      .default('open'),
    createdAt: integer('created_at'),
  },
  (t) => [index('duplicate_suggestions_status_idx').on(t.status)],
);

export const assetMerges = sqliteTable(
  'asset_merges',
  {
    id: text('id').primaryKey(),
    survivingAssetId: text('surviving_asset_id').notNull(),
    mergedAssetId: text('merged_asset_id').notNull(),
    movedInstanceIdsJson: text('moved_instance_ids_json').notNull(),
    mergedBy: text('merged_by').notNull(),
    snapshotJson: text('snapshot_json'),
    createdAt: integer('created_at'),
    undoneAt: integer('undone_at'),
  },
  (t) => [index('asset_merges_created_at_idx').on(t.createdAt)],
);

export const enrichmentRuns = sqliteTable(
  'enrichment_runs',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id').notNull(),
    pluginVersion: text('plugin_version').notNull(),
    status: text('status', { enum: ['done', 'skipped', 'failed'] }).notNull(),
    error: text('error'),
    completedAt: integer('completed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.pluginId] }),
    index('enrichment_runs_plugin_idx').on(t.pluginId),
  ],
);
