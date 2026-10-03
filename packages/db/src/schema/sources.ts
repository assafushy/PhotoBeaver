import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { assets } from './assets';
import { plugins } from './plugins';

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  pluginId: text('plugin_id')
    .notNull()
    .references(() => plugins.id),
  displayName: text('display_name').notNull(),
  configJson: text('config_json').notNull(),
  secretRef: text('secret_ref'),
  syncCursor: text('sync_cursor'),
  syncState: text('sync_state', {
    enum: ['idle', 'queued', 'running', 'error', 'auth_required', 'paused'],
  })
    .notNull()
    .default('idle'),
  scheduleJson: text('schedule_json').notNull(),
  lastSyncStartedAt: integer('last_sync_started_at'),
  lastSyncFinishedAt: integer('last_sync_finished_at'),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').default(0),
  nextRunAt: integer('next_run_at'),
  createdAt: integer('created_at'),
});

export const instances = sqliteTable(
  'instances',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url'),
    path: text('path'),
    sizeBytes: integer('size_bytes'),
    sourceModifiedAt: integer('source_modified_at'),
    sourceMetadataJson: text('source_metadata_json'),
    etag: text('etag'),
    seenRunId: text('seen_run_id'),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    unique('instances_source_external_unique').on(t.sourceId, t.externalId),
    index('instances_asset_idx').on(t.assetId),
  ],
);
