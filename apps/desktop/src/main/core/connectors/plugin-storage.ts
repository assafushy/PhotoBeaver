import { schema, type LibraryDb } from '@photobeaver/db';
import type { PluginStorage } from '@photobeaver/plugin-sdk';
import { and, eq } from 'drizzle-orm';

const { pluginKv } = schema;

/**
 * Per-plugin key-value storage over `plugin_kv` (SPEC 6.4 `ctx.storage`).
 * Setting `undefined` deletes the key, so a stored null and a missing key differ.
 *
 * @param db - Library database.
 * @param pluginId - Owning plugin.
 * @returns The storage API.
 */
export function createPluginStorage(db: LibraryDb, pluginId: string): PluginStorage {
  const where = (key: string) => and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.key, key));
  const remove = async (key: string): Promise<void> =>
    void db.delete(pluginKv).where(where(key)).run();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const row = db.select({ value: pluginKv.valueJson }).from(pluginKv).where(where(key)).get();
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      if (value === undefined) return remove(key);
      const valueJson = JSON.stringify(value);
      db.insert(pluginKv)
        .values({ pluginId, key, valueJson })
        .onConflictDoUpdate({ target: [pluginKv.pluginId, pluginKv.key], set: { valueJson } })
        .run();
    },
    delete: remove,
  };
}
