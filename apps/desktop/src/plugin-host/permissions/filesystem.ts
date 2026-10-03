import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { FilesystemPermissionError, isPathAllowed, toAbsolutePath } from './path-guard';

type AnyFn = (...args: unknown[]) => unknown;

const ONE_PATH = [
  'access',
  'appendFile',
  'chmod',
  'chown',
  'createReadStream',
  'createWriteStream',
  'exists',
  'lchown',
  'lstat',
  'lutimes',
  'mkdir',
  'mkdtemp',
  'open',
  'opendir',
  'readdir',
  'readFile',
  'readlink',
  'realpath',
  'rm',
  'rmdir',
  'stat',
  'statfs',
  'truncate',
  'unlink',
  'utimes',
  'watch',
  'watchFile',
  'writeFile',
];
const TWO_PATHS = ['copyFile', 'cp', 'link', 'rename', 'symlink'];

/**
 * Live set of folders a plugin may touch. Grants grow when the user picks a
 * folder or a source config names one.
 */
export class FolderGrants {
  private readonly dirs = new Set<string>();

  constructor(initial: Iterable<string>) {
    for (const dir of initial) this.dirs.add(dir);
  }

  add(dir: string): void {
    this.dirs.add(dir);
  }

  assert(value: unknown): void {
    const target = toAbsolutePath(value);
    if (target !== null && !isPathAllowed(target, this.dirs))
      throw new FilesystemPermissionError(target);
  }
}

function wrap(
  target: Record<string, AnyFn>,
  name: string,
  grants: FolderGrants,
  pathCount: number,
  promised: boolean,
): void {
  const original = target[name];
  if (typeof original !== 'function') return;
  target[name] = function guarded(this: unknown, ...args: unknown[]) {
    try {
      for (let i = 0; i < pathCount; i++) grants.assert(args[i]);
    } catch (error) {
      if (promised) return Promise.reject(error);
      throw error;
    }
    return original.apply(this, args);
  };
}

function wrapAll(target: Record<string, AnyFn>, grants: FolderGrants, promised: boolean): void {
  for (const [names, count] of [
    [ONE_PATH, 1],
    [TWO_PATHS, 2],
  ] as const) {
    for (const name of names) {
      wrap(target, name, grants, count, promised);
      if (!promised) wrap(target, `${name}Sync`, grants, count, false);
    }
  }
}

/**
 * Limits fs access to granted folders by patching `fs` and `fs/promises`, then
 * syncing the ESM named exports so `import { readFile } from 'node:fs'` is
 * guarded too (SPEC 6.6). Defense in depth, not a sandbox.
 *
 * @param grants - Allowed folders (dataDir, temp, plugin folder, user grants).
 */
export function installFilesystemGuard(grants: FolderGrants): void {
  wrapAll(fs as unknown as Record<string, AnyFn>, grants, false);
  wrapAll(fs.promises as unknown as Record<string, AnyFn>, grants, true);
  syncBuiltinESMExports();
}
