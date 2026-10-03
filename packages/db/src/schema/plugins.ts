import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  type: text('type', { enum: ['connector', 'enricher'] }).notNull(),
  enabled: integer('enabled').notNull().default(1),
  manifestJson: text('manifest_json').notNull(),
  grantedPermissionsJson: text('granted_permissions_json').notNull(),
  installSource: text('install_source', { enum: ['builtin', 'registry', 'file', 'dev'] }).notNull(),
  health: text('health', { enum: ['ok', 'degraded', 'crashed', 'disabled_by_system'] })
    .notNull()
    .default('ok'),
  installedAt: integer('installed_at'),
  updatedAt: integer('updated_at'),
});

export const pluginKv = sqliteTable(
  'plugin_kv',
  {
    pluginId: text('plugin_id').notNull(),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
  },
  (t) => [primaryKey({ columns: [t.pluginId, t.key] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json'),
});
