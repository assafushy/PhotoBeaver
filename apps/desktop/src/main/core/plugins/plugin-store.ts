import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import {
  isApiVersionSupported,
  validateManifest,
  type PluginManifest,
} from '@photobeaver/shared/manifest';
import { MANIFEST_FILE, sha256Hex, unpackPlugin } from '@photobeaver/shared/pbplugin';

export interface PluginPaths {
  pluginsDir: string;
  pluginDataDir: string;
  tempDir: string;
}

export interface StagedPackage {
  dir: string;
  manifest: PluginManifest;
  sha256: string;
}

/**
 * Error for a plugin that fails manifest validation or targets an unsupported API.
 */
export class InvalidPluginError extends Error {
  override readonly name = 'InvalidPluginError';
}

/**
 * Reads and validates `photobeaver-plugin.json` (SPEC 5.2, on install and on every load).
 *
 * @param dir - Plugin folder.
 * @returns The manifest.
 * @throws InvalidPluginError when missing, invalid or incompatible.
 */
export function readManifest(dir: string): PluginManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
  } catch {
    throw new InvalidPluginError(`No readable ${MANIFEST_FILE} in ${dir}`);
  }
  const result = validateManifest(raw);
  if (!result.ok) throw new InvalidPluginError(`Invalid manifest: ${result.errors.join('; ')}`);
  if (!isApiVersionSupported(result.manifest.apiVersion)) {
    throw new InvalidPluginError(
      `Incompatible: built for plugin API ${result.manifest.apiVersion}`,
    );
  }
  return result.manifest;
}

/**
 * Plugin files on disk (SPEC 4.1): `plugins/<id>/<version>/`, `plugin-data/<id>/`,
 * and a staging area for packages awaiting consent.
 */
export class PluginStore {
  constructor(private readonly paths: PluginPaths) {}

  versionDir(manifest: Pick<PluginManifest, 'id' | 'version'>): string {
    return path.join(this.paths.pluginsDir, manifest.id, manifest.version);
  }

  dataDir(pluginId: string): string {
    return path.join(this.paths.pluginDataDir, pluginId);
  }

  tempDir(pluginId: string): string {
    return path.join(this.paths.tempDir, pluginId);
  }

  /**
   * Copies a validated plugin folder into its version folder (replacing it). The
   * folder's own `node_modules` (development dependencies) is skipped; bundled
   * native dependencies under `dist/node_modules` are kept.
   *
   * @param sourceDir - Folder holding the plugin.
   * @param manifest - Its manifest.
   * @returns The installed folder.
   */
  installCopy(sourceDir: string, manifest: PluginManifest): string {
    const target = this.versionDir(manifest);
    const incoming = `${target}.installing`;
    rmSync(incoming, { recursive: true, force: true });
    cpSync(sourceDir, incoming, {
      recursive: true,
      filter: (src) => path.relative(sourceDir, src).split(path.sep)[0] !== 'node_modules',
    });
    rmSync(target, { recursive: true, force: true });
    renameSync(incoming, target);
    return target;
  }

  /**
   * Unpacks a `.pbplugin` into staging and validates it, without installing.
   *
   * @param file - Package path.
   * @returns The staged folder, manifest and hash.
   */
  stage(file: string): StagedPackage {
    const bytes = readFileSync(file);
    mkdirSync(this.paths.tempDir, { recursive: true });
    const dir = mkdtempSync(path.join(this.paths.tempDir, 'staged-'));
    try {
      unpackPlugin(bytes, dir);
      return { dir, manifest: readManifest(dir), sha256: sha256Hex(bytes) };
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error instanceof InvalidPluginError
        ? error
        : new InvalidPluginError(String((error as Error).message ?? error));
    }
  }

  remove(dir: string): void {
    rmSync(dir, { recursive: true, force: true });
  }

  /**
   * Deletes every installed version of a plugin except one.
   *
   * @param pluginId - Plugin id.
   * @param keep - Absolute folder to keep, or null to delete all.
   */
  pruneVersions(pluginId: string, keep: string | null): void {
    const root = path.join(this.paths.pluginsDir, pluginId);
    if (!existsSync(root)) return;
    for (const version of readdirSync(root)) {
      const dir = path.join(root, version);
      if (dir !== keep) rmSync(dir, { recursive: true, force: true });
    }
    if (keep === null) rmSync(root, { recursive: true, force: true });
  }

  removeData(pluginId: string): void {
    rmSync(this.dataDir(pluginId), { recursive: true, force: true });
  }
}
