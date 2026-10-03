import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['sync_source', 'enrich', 'thumbnail', 'plugin_task'] }).notNull(),
    pluginId: text('plugin_id'),
    sourceId: text('source_id'),
    assetId: text('asset_id'),
    payloadJson: text('payload_json'),
    priority: integer('priority').notNull().default(100),
    status: text('status', { enum: ['queued', 'leased', 'done', 'failed', 'dead'] })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: integer('run_after').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key').unique(),
    createdAt: integer('created_at'),
    updatedAt: integer('updated_at'),
  },
  (t) => [index('jobs_status_priority_run_after_idx').on(t.status, t.priority, t.runAfter)],
);
