import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

export interface AppPaths {
  userDataDir: string;
  libraryDir: string;
  logsDir: string;
  migrationsFolder: string;
  pluginsDir: string;
  pluginDataDir: string;
  pluginTempDir: string;
  defaultPluginsDir: string;
  pluginHostEntry: string;
}

const USER_DATA_ENV = 'PB_USER_DATA_DIR';

/**
 * Lets tests and developers point an unpackaged build at a throwaway userData
 * folder. Ignored in packaged builds. Must run before the `ready` event.
 */
export function applyUserDataOverride(): void {
  const override = process.env[USER_DATA_ENV];
  if (override && !app.isPackaged) app.setPath('userData', path.resolve(override));
}

function defaultPluginsDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'plugins');
  return fileURLToPath(new URL('./default-plugins', import.meta.url));
}

/**
 * Resolves every on-disk location the core needs (SPEC section 4.1).
 *
 * @returns Absolute paths for userData, library, logs, migrations and plugins.
 */
export function resolveAppPaths(): AppPaths {
  const userDataDir = app.getPath('userData');
  return {
    userDataDir,
    libraryDir: path.join(userDataDir, 'library'),
    logsDir: path.join(userDataDir, 'logs'),
    migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
    pluginsDir: path.join(userDataDir, 'plugins'),
    pluginDataDir: path.join(userDataDir, 'plugin-data'),
    pluginTempDir: path.join(userDataDir, 'plugin-temp'),
    defaultPluginsDir: defaultPluginsDir(),
    pluginHostEntry: fileURLToPath(new URL('./plugin-host.js', import.meta.url)),
  };
}

/**
 * Dev and test hook that slows sync down between batches, so a crash mid-sync can
 * be exercised. Ignored in packaged builds.
 *
 * @returns Delay in milliseconds, or undefined.
 */
export function devSyncBatchDelayMs(): number | undefined {
  const value = Number(process.env.PB_SYNC_BATCH_DELAY_MS);
  return !app.isPackaged && value > 0 ? value : undefined;
}
