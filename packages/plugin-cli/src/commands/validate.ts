import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isApiVersionSupported, type PluginManifest } from '@photobeaver/shared/manifest';
import type { CliArgs } from '../args';
import type { Output } from '../output';
import { checkNativeDependencies } from '../native-check';
import { readManifest } from '../project';
import { checkExportShape } from '../shape';

export type ValidateResult =
  { ok: true; manifest: PluginManifest; warnings: string[] } | { ok: false; errors: string[] };

function apiVersionErrors(manifest: PluginManifest): string[] {
  if (isApiVersionSupported(manifest.apiVersion)) return [];
  return [`apiVersion: "${manifest.apiVersion}" is not supported by this version of Photo Beaver`];
}

async function importFresh(file: string): Promise<Record<string, unknown>> {
  return (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as Record<string, unknown>;
}

async function mainErrors(dir: string, manifest: PluginManifest): Promise<string[]> {
  const main = path.join(dir, manifest.main);
  if (!existsSync(main)) return [`main: ${manifest.main} not found. Run pb-plugin build first.`];
  try {
    return checkExportShape(manifest.type, await importFresh(main));
  } catch (error) {
    return [`main: could not load ${manifest.main}: ${(error as Error).message}`];
  }
}

/**
 * Validates a plugin project: manifest schema, API version, native dependencies against
 * `permissions.nativeModules`, and the built main's exports.
 *
 * @param dir - Plugin project folder.
 * @returns The manifest and any warnings when valid, or readable errors.
 */
export async function validateProject(dir: string): Promise<ValidateResult> {
  const read = await readManifest(dir);
  if (!read.ok) return read;
  const { manifest } = read;
  const native = checkNativeDependencies(dir, manifest);
  const errors = [
    ...apiVersionErrors(manifest),
    ...native.errors,
    ...(await mainErrors(dir, manifest)),
  ];
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest, warnings: native.warnings };
}

/**
 * Prints warnings, one per line.
 *
 * @param out - CLI output.
 * @param warnings - Readable warnings.
 */
export function reportWarnings(out: Output, warnings: string[]): void {
  for (const warning of warnings) out.error(`Warning: ${warning}`);
}

/**
 * Prints validation errors, one per line.
 *
 * @param out - CLI output.
 * @param errors - Readable errors.
 * @returns Exit code 1.
 */
export function reportErrors(out: Output, errors: string[]): number {
  for (const error of errors) out.error(`  ${error}`);
  return 1;
}

/**
 * `pb-plugin validate`.
 *
 * @param args - Parsed CLI arguments.
 * @param out - CLI output.
 * @returns Process exit code.
 */
export async function runValidate(args: CliArgs, out: Output): Promise<number> {
  const result = await validateProject(args.dir);
  if (!result.ok) {
    out.error('Plugin is not valid:');
    return reportErrors(out, result.errors);
  }
  reportWarnings(out, result.warnings);
  out.info(`Valid: ${result.manifest.id}@${result.manifest.version} (${result.manifest.type})`);
  return 0;
}
