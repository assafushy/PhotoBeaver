import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

export interface AppPaths {
  userDataDir: string;
  libraryDir: string;
  logsDir: string;
  migrationsFolder: string;
}

const USER_DATA_ENV = 'PB_USER_DATA_DIR';

/**
 * Lets tests and developers point the app at a throwaway userData folder.
 * Must run before the `ready` event.
 */
export function applyUserDataOverride(): void {
  const override = process.env[USER_DATA_ENV];
  if (override) app.setPath('userData', path.resolve(override));
}

/**
 * Resolves every on-disk location the core needs (SPEC section 4.1).
 *
 * @returns Absolute paths for userData, library, logs and migrations.
 */
export function resolveAppPaths(): AppPaths {
  const userDataDir = app.getPath('userData');
  return {
    userDataDir,
    libraryDir: path.join(userDataDir, 'library'),
    logsDir: path.join(userDataDir, 'logs'),
    migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
  };
}
