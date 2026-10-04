import type { PluginManifest } from '@photobeaver/shared/manifest';
import { MANIFEST_FILE } from '@photobeaver/shared/pbplugin';
import { NATIVE_DEPS_FIELD, readNativeDependencies } from './native-deps';

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

/**
 * Compares declared native dependencies with the manifest's `permissions.nativeModules` flag.
 *
 * @param names - Native package names declared in package.json.
 * @param allowed - The manifest's `permissions.nativeModules`.
 * @returns An error when native packages are declared without the permission, a warning when
 * the permission is set but nothing is declared.
 */
export function nativeModulesFlagCheck(names: string[], allowed: boolean): CheckResult {
  if (names.length > 0 && !allowed) {
    const error = `permissions.nativeModules: package.json declares native dependencies (${names.join(', ')}), so ${MANIFEST_FILE} must set "permissions": { "nativeModules": true }`;
    return { errors: [error], warnings: [] };
  }
  if (names.length === 0 && allowed) {
    const warning = `permissions.nativeModules is true but package.json declares no ${NATIVE_DEPS_FIELD}`;
    return { errors: [], warnings: [warning] };
  }
  return { errors: [], warnings: [] };
}

/**
 * Checks a plugin project's native dependencies against its manifest.
 *
 * @param dir - Plugin project folder.
 * @param manifest - The validated manifest.
 * @returns Errors and warnings.
 */
export function checkNativeDependencies(dir: string, manifest: PluginManifest): CheckResult {
  try {
    return nativeModulesFlagCheck(readNativeDependencies(dir), manifest.permissions.nativeModules);
  } catch (error) {
    return { errors: [(error as Error).message], warnings: [] };
  }
}
