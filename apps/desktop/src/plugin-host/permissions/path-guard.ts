import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Error thrown when a plugin touches a path outside its granted folders.
 */
export class FilesystemPermissionError extends Error {
  override readonly name = 'FilesystemPermissionError';

  constructor(target: string) {
    super(`Access to "${target}" is not allowed by this plugin's permissions`);
  }
}

/**
 * Converts any fs path argument to an absolute path, or null for file descriptors.
 *
 * @param value - string, Buffer, URL or fd.
 * @returns Absolute path, or null when not a path.
 */
export function toAbsolutePath(value: unknown): string | null {
  if (typeof value === 'number') return null;
  if (value instanceof URL) return path.resolve(fileURLToPath(value));
  if (Buffer.isBuffer(value)) return path.resolve(value.toString());
  return typeof value === 'string' ? path.resolve(value) : null;
}

const normalize = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);

/**
 * Whether a path is one of the allowed folders or inside one.
 *
 * @param target - Absolute path.
 * @param allowed - Allowed absolute folders.
 * @returns True when inside an allowed folder.
 */
export function isPathAllowed(target: string, allowed: Iterable<string>): boolean {
  const resolved = normalize(path.resolve(target));
  for (const dir of allowed) {
    const root = normalize(path.resolve(dir));
    if (resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep))
      return true;
  }
  return false;
}
