import { schema, type LibraryDb } from '@photobeaver/db';
import { validateConfig, type ConfigSchema } from '@photobeaver/shared';
import { eq } from 'drizzle-orm';

const keyOf = (pluginId: string): string => `plugin.settings.${pluginId}`;

/**
 * Global settings of a plugin (SPEC 5.2 `configSchema` for enrichers), stored
 * in `settings` and returned with schema defaults applied.
 */
export class PluginSettings {
  constructor(private readonly db: LibraryDb) {}

  /**
   * Reads a plugin's settings.
   *
   * @param pluginId - Plugin id.
   * @param configSchema - The plugin's schema, for defaults.
   * @returns Stored values merged over defaults (invalid stored values fall back to defaults).
   */
  get(pluginId: string, configSchema: ConfigSchema): Record<string, unknown> {
    const stored = this.stored(pluginId);
    const result = validateConfig(configSchema, stored);
    return result.ok
      ? result.value
      : ((validateConfig(configSchema, {}) as { value?: Record<string, unknown> }).value ?? {});
  }

  /**
   * Validates and stores a plugin's settings.
   *
   * @param pluginId - Plugin id.
   * @param configSchema - The plugin's schema.
   * @param values - New values.
   * @throws Error listing invalid fields.
   */
  set(pluginId: string, configSchema: ConfigSchema, values: Record<string, unknown>): void {
    const result = validateConfig(configSchema, values);
    if (!result.ok)
      throw new Error(
        `Invalid settings: ${Object.entries(result.errors)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')}`,
      );
    const valueJson = JSON.stringify(result.value);
    this.db
      .insert(schema.settings)
      .values({ key: keyOf(pluginId), valueJson })
      .onConflictDoUpdate({ target: schema.settings.key, set: { valueJson } })
      .run();
  }

  private stored(pluginId: string): Record<string, unknown> {
    const row = this.db
      .select({ value: schema.settings.valueJson })
      .from(schema.settings)
      .where(eq(schema.settings.key, keyOf(pluginId)))
      .get();
    return row?.value ? (JSON.parse(row.value) as Record<string, unknown>) : {};
  }
}

/**
 * Reads a boolean app setting.
 *
 * @param db - Library database.
 * @param key - Setting key.
 * @param fallback - Value when unset.
 * @returns The setting.
 */
export function readFlag(db: LibraryDb, key: string, fallback: boolean): boolean {
  const row = db
    .select({ value: schema.settings.valueJson })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get();
  return row?.value ? (JSON.parse(row.value) as boolean) : fallback;
}
