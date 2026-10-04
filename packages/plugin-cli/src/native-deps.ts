import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const NATIVE_DEPS_FIELD = 'photobeaver.nativeDependencies';

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

interface PackageJsonShape {
  photobeaver?: { nativeDependencies?: unknown };
}

function readPackageJson(dir: string): PackageJsonShape | null {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJsonShape | null;
  } catch (error) {
    throw new Error(`package.json is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

function isPackageNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((n) => typeof n === 'string' && PACKAGE_NAME.test(n));
}

/**
 * Reads `photobeaver.nativeDependencies` from a plugin's package.json.
 *
 * @param dir - Plugin project folder.
 * @returns The declared package names, empty when none are declared.
 * @throws Error when package.json is unreadable or the field is not a list of package names.
 */
export function readNativeDependencies(dir: string): string[] {
  const declared = readPackageJson(dir)?.photobeaver?.nativeDependencies;
  if (declared === undefined) return [];
  if (!isPackageNameList(declared)) {
    throw new Error(`package.json: ${NATIVE_DEPS_FIELD} must be an array of npm package names`);
  }
  return declared;
}

/**
 * The esbuild `external` patterns for native packages: each name and its subpaths.
 *
 * @param names - Native package names.
 * @returns External patterns.
 */
export function nativeExternals(names: string[]): string[] {
  return names.flatMap((name) => [name, `${name}/*`]);
}
