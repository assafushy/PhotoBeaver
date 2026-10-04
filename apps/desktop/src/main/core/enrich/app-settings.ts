import { schema, type LibraryDb } from '@photobeaver/db';
import type { AppSettings } from '@photobeaver/shared';
import { eq } from 'drizzle-orm';
import { ALWAYS_ASK_KEY } from './merge-service';

const TILE_URL_KEY = 'map.tileUrl';

function read<T>(db: LibraryDb, key: string, fallback: T): T {
  const row = db
    .select({ value: schema.settings.valueJson })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get();
  return row?.value ? (JSON.parse(row.value) as T) : fallback;
}

function write(db: LibraryDb, key: string, value: unknown): void {
  const valueJson = JSON.stringify(value);
  db.insert(schema.settings)
    .values({ key, valueJson })
    .onConflictDoUpdate({ target: schema.settings.key, set: { valueJson } })
    .run();
}

/**
 * Validates an online map tile URL template: https only, with {z}, {x} and {y}.
 *
 * @param url - Template or null to stay offline.
 * @returns The URL.
 * @throws Error for anything else.
 */
export function validateTileUrl(url: string | null): string | null {
  if (url === null || url.trim() === '') return null;
  const parsed = new URL(url.replace(/\{[xyz]\}/g, '0'));
  if (parsed.protocol !== 'https:' || !['{z}', '{x}', '{y}'].every((p) => url.includes(p))) {
    throw new Error('Use an https tile URL containing {z}, {x} and {y}');
  }
  return url;
}

/**
 * Library-wide settings exposed to the UI in M3: the optional online map tiles
 * (off by default, SPEC 10 privacy) and "always ask before merging duplicates".
 */
export const appSettings = {
  get: (db: LibraryDb): AppSettings => ({
    mapTileUrl: read<string | null>(db, TILE_URL_KEY, null),
    duplicatesAlwaysAsk: read(db, ALWAYS_ASK_KEY, false),
  }),

  set(db: LibraryDb, patch: Partial<AppSettings>): void {
    if (patch.mapTileUrl !== undefined) write(db, TILE_URL_KEY, validateTileUrl(patch.mapTileUrl));
    if (patch.duplicatesAlwaysAsk !== undefined)
      write(db, ALWAYS_ASK_KEY, patch.duplicatesAlwaysAsk);
  },
};
