import { cpSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  DEFAULT_PRUNE_RULES,
  nativeTarget,
  type NativeTarget,
  type PruneRules,
} from './native-prune';

export const NATIVE_MODULES_DIR = 'dist/node_modules';

export interface NativeCopyOptions {
  pruneRules?: PruneRules;
  target?: NativeTarget;
}

function notFound(name: string, fromDir: string): Error {
  return new Error(
    `nativeDependencies: cannot find "${name}" from ${fromDir}. Install it with "npm install ${name}".`,
  );
}

function searchPackageDir(requireFrom: NodeJS.Require, name: string, fromDir: string): string {
  const found = (requireFrom.resolve.paths(name) ?? [])
    .map((base) => path.join(base, name))
    .find((dir) => existsSync(path.join(dir, 'package.json')));
  if (!found) throw notFound(name, fromDir);
  return found;
}

function resolvePackageDir(fromDir: string, name: string): string {
  const requireFrom = createRequire(path.join(fromDir, 'package.json'));
  try {
    return realpathSync(path.dirname(requireFrom.resolve(`${name}/package.json`)));
  } catch {
    return realpathSync(searchPackageDir(requireFrom, name, fromDir));
  }
}

function productionDependencies(packageDir: string): string[] {
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(manifest.dependencies ?? {});
}

function collectPackages(fromDir: string, names: string[], found: Map<string, string>): void {
  for (const name of names) {
    if (found.has(name)) continue;
    const dir = resolvePackageDir(fromDir, name);
    found.set(name, dir);
    collectPackages(dir, productionDependencies(dir), found);
  }
}

function isNestedNodeModules(root: string, file: string): boolean {
  return path.relative(root, file).split(path.sep).includes('node_modules');
}

function copyPackage(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: (file) => !isNestedNodeModules(source, file),
  });
}

/**
 * Copies native packages and their production dependencies (flat, first version found wins)
 * into `dist/node_modules`, then applies the prune rule of each package that has one.
 *
 * @param pluginDir - Plugin project folder.
 * @param names - Declared native package names.
 * @param options - Prune rules and target platform (defaults: built-in rules, current platform).
 * @returns The names of every copied package.
 * @throws Error when a package cannot be found.
 */
export function copyNativeDependencies(
  pluginDir: string,
  names: string[],
  options: NativeCopyOptions = {},
): string[] {
  const destination = path.join(pluginDir, NATIVE_MODULES_DIR);
  rmSync(destination, { recursive: true, force: true });
  const packages = new Map<string, string>();
  collectPackages(pluginDir, names, packages);
  const rules = options.pruneRules ?? DEFAULT_PRUNE_RULES;
  const target = options.target ?? nativeTarget();
  for (const [name, source] of packages) {
    copyPackage(source, path.join(destination, name));
    rules[name]?.(path.join(destination, name), target);
  }
  return [...packages.keys()];
}
