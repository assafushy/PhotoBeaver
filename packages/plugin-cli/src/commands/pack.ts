import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PluginManifest } from '@photobeaver/shared/manifest';
import { PACKAGE_EXTENSION, packPlugin, sha256Hex } from '@photobeaver/shared/pbplugin';
import type { CliArgs } from '../args';
import { buildPlugin } from '../bundle';
import type { Output } from '../output';
import { reportErrors, validateProject } from './validate';

export interface PackedPlugin {
  packagePath: string;
  checksumPath: string;
  sha256: string;
}

export type PackResult = ({ ok: true } & PackedPlugin) | { ok: false; errors: string[] };

/**
 * The package file name for a manifest: `<id>-<version>.pbplugin`.
 *
 * @param manifest - Plugin manifest.
 * @returns File name.
 */
export function packageFileName(manifest: PluginManifest): string {
  return `${manifest.id}-${manifest.version}${PACKAGE_EXTENSION}`;
}

function writePackage(dir: string, manifest: PluginManifest): PackedPlugin {
  const fileName = packageFileName(manifest);
  const bytes = packPlugin(dir);
  const sha256 = sha256Hex(bytes);
  const packagePath = path.join(dir, fileName);
  const checksumPath = `${packagePath}.sha256`;
  writeFileSync(packagePath, bytes);
  writeFileSync(checksumPath, `${sha256}  ${fileName}\n`);
  return { packagePath, checksumPath, sha256 };
}

/**
 * Builds, validates and packs a plugin into `<id>-<version>.pbplugin` plus a `.sha256` file.
 *
 * @param dir - Plugin project folder.
 * @returns Paths and hash, or readable errors.
 */
export async function packProject(dir: string): Promise<PackResult> {
  const built = await buildPlugin(dir);
  if (!built.ok) return built;
  const valid = await validateProject(dir);
  if (!valid.ok) return valid;
  return { ok: true, ...writePackage(dir, valid.manifest) };
}

/**
 * `pb-plugin pack`.
 *
 * @param args - Parsed CLI arguments.
 * @param out - CLI output.
 * @returns Process exit code.
 */
export async function runPack(args: CliArgs, out: Output): Promise<number> {
  const result = await packProject(args.dir);
  if (!result.ok) {
    out.error('Pack failed:');
    return reportErrors(out, result.errors);
  }
  out.info(`Packed ${result.packagePath}`);
  out.info(`sha256 ${result.sha256}`);
  return 0;
}
