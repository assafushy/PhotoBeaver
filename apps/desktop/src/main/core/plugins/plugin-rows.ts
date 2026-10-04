import { schema, type LibraryDb } from '@photobeaver/db';
import type { PluginManifest } from '@photobeaver/shared/manifest';
import { count, eq } from 'drizzle-orm';

const { plugins, sources, settings } = schema;
const REMOVED_DEFAULTS_KEY = 'plugins.removedDefaults';
const DEVELOPER_MODE_KEY = 'plugins.developerMode';

export type PluginRow = typeof plugins.$inferSelect;
export type InstallSource = PluginRow['installSource'];

export interface InstallRecord {
  manifest: PluginManifest;
  installSource: InstallSource;
  installPath: string;
  enabled: boolean;
}

function readSetting<T>(db: LibraryDb, key: string, fallback: T): T {
  const row = db
    .select({ value: settings.valueJson })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ? (JSON.parse(row.value) as T) : fallback;
}

function writeSetting(db: LibraryDb, key: string, value: unknown): void {
  const valueJson = JSON.stringify(value);
  db.insert(settings)
    .values({ key, valueJson })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
    .run();
}

/**
 * Database access for the `plugins` table and plugin-related settings.
 */
export const pluginRows = {
  get: (db: LibraryDb, id: string): PluginRow | undefined =>
    db.select().from(plugins).where(eq(plugins.id, id)).get(),

  list: (db: LibraryDb): PluginRow[] => db.select().from(plugins).orderBy(plugins.id).all(),

  upsert(db: LibraryDb, record: InstallRecord, now: number): void {
    const { manifest } = record;
    const values = {
      version: manifest.version,
      type: manifest.type,
      manifestJson: JSON.stringify(manifest),
      grantedPermissionsJson: JSON.stringify(manifest.permissions),
      installSource: record.installSource,
      installPath: record.installPath,
      enabled: record.enabled ? 1 : 0,
      updatedAt: now,
    };
    db.insert(plugins)
      .values({ id: manifest.id, installedAt: now, ...values })
      .onConflictDoUpdate({ target: plugins.id, set: values })
      .run();
  },

  restore: (db: LibraryDb, row: PluginRow): void =>
    void db.update(plugins).set(row).where(eq(plugins.id, row.id)).run(),

  update: (db: LibraryDb, id: string, values: Partial<PluginRow>): void =>
    void db.update(plugins).set(values).where(eq(plugins.id, id)).run(),

  delete: (db: LibraryDb, id: string): void =>
    void db.delete(plugins).where(eq(plugins.id, id)).run(),

  sourceCount: (db: LibraryDb, id: string): number =>
    db.select({ n: count() }).from(sources).where(eq(sources.pluginId, id)).get()?.n ?? 0,

  removedDefaults: (db: LibraryDb): string[] => readSetting<string[]>(db, REMOVED_DEFAULTS_KEY, []),

  setRemovedDefaults: (db: LibraryDb, ids: string[]): void =>
    writeSetting(db, REMOVED_DEFAULTS_KEY, [...new Set(ids)]),

  developerMode: (db: LibraryDb): boolean => readSetting(db, DEVELOPER_MODE_KEY, false),

  setDeveloperMode: (db: LibraryDb, enabled: boolean): void =>
    writeSetting(db, DEVELOPER_MODE_KEY, enabled),
};
