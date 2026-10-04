import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync, zipSync } from 'fflate';

export const MANIFEST_FILE = 'photobeaver-plugin.json';
export const PACKAGE_EXTENSION = '.pbplugin';
const PACKED_ENTRIES = [MANIFEST_FILE, 'dist', 'assets', 'README.md', 'LICENSE', 'package.json'];
export const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

type FileMap = Record<string, Uint8Array>;

function unpackedBytes(files: FileMap): number {
  return Object.values(files).reduce((sum, data) => sum + data.byteLength, 0);
}

function addEntry(files: FileMap, root: string, relative: string): void {
  const absolute = path.join(root, relative);
  if (statSync(absolute).isDirectory()) {
    for (const name of readdirSync(absolute))
      addEntry(files, root, path.posix.join(relative, name));
  } else {
    files[relative] = readFileSync(absolute);
  }
}

/**
 * Builds a `.pbplugin` archive (SPEC 5.4): a zip of the plugin folder with the
 * manifest, `dist/` (including `dist/node_modules` for native dependencies), `assets/`,
 * README, LICENSE and package.json at its root.
 *
 * @param pluginDir - Plugin project folder.
 * @returns Zip bytes.
 * @throws Error when the manifest is missing or the contents exceed the 512 MB install limit.
 */
export function packPlugin(pluginDir: string): Uint8Array {
  const files: FileMap = {};
  for (const entry of PACKED_ENTRIES) {
    try {
      addEntry(files, pluginDir, entry);
    } catch {
      continue;
    }
  }
  if (!files[MANIFEST_FILE]) throw new Error(`${MANIFEST_FILE} not found in ${pluginDir}`);
  if (unpackedBytes(files) > MAX_UNPACKED_BYTES) {
    throw new Error('Package contents exceed the 512 MB limit Photo Beaver can install');
  }
  return zipSync(files, { level: 9 });
}

/**
 * Hex SHA-256 of a package, as published next to it in `<name>.sha256`.
 *
 * @param bytes - Package bytes.
 * @returns Lowercase hex digest.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeTarget(root: string, name: string): string {
  const target = path.resolve(root, name);
  if (
    path.isAbsolute(name) ||
    name.split(/[\\/]/).includes('..') ||
    !target.startsWith(path.resolve(root) + path.sep)
  ) {
    throw new Error(`Unsafe path in package: ${name}`);
  }
  return target;
}

/**
 * Extracts a `.pbplugin` into a folder, refusing absolute or `..` paths
 * (zip slip) and archives that expand beyond 512 MB.
 *
 * @param bytes - Package bytes.
 * @param targetDir - Empty folder to extract into.
 * @returns The manifest JSON text.
 */
export function unpackPlugin(bytes: Uint8Array, targetDir: string): string {
  const entries = unzipSync(bytes);
  if (unpackedBytes(entries) > MAX_UNPACKED_BYTES) throw new Error('Package is too large');
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const target = safeTarget(targetDir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  const manifest = entries[MANIFEST_FILE];
  if (!manifest) throw new Error(`Package has no ${MANIFEST_FILE}`);
  return strFromU8(manifest);
}
