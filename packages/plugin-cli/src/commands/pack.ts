import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PluginManifest } from '@photobeaver/shared/manifest';
import { PACKAGE_EXTENSION, packPlugin, sha256Hex } from '@photobeaver/shared/pbplugin';
import type { CliArgs } from '../args';
import { buildPlugin } from '../bundle';
import type { NativeCopyOptions } from '../native-copy';
import type { Output } from '../output';
import { reportErrors, reportWarnings, validateProject } from './validate';

export interface PackedPlugin {
  packagePath: string;
  checksumPath: string;
  sha256: string;
}

export type PackResult =
  ({ ok: true; warnings: string[] } & PackedPlugin) | { ok: false; errors: string[] };

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
 * @param native - Prune rules and target platform for native dependencies.
 * @returns Paths, hash and validation warnings, or readable errors.
 */
export async function packProject(
  dir: string,
  native: NativeCopyOptions = {},
): Promise<PackResult> {
  const built = await buildPlugin(dir, native);
  if (!built.ok) return built;
  const valid = await validateProject(dir);
  if (!valid.ok) return valid;
  try {
    return { ok: true, warnings: valid.warnings, ...writePackage(dir, valid.manifest) };
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }
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
  reportWarnings(out, result.warnings);
  out.info(`Packed ${result.packagePath}`);
  out.info(`sha256 ${result.sha256}`);
  return 0;
}
