import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateManifest, type PluginManifest } from '@photobeaver/shared/manifest';
import { MANIFEST_FILE } from '@photobeaver/shared/pbplugin';

export type ManifestRead = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

async function readJson(file: string): Promise<{ value: unknown } | { error: string }> {
  try {
    return { value: JSON.parse(await readFile(file, 'utf8')) as unknown };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { error: `${MANIFEST_FILE} not found in ${path.dirname(file)}` };
    return { error: `${MANIFEST_FILE} is not valid JSON: ${(error as Error).message}` };
  }
}

/**
 * Reads and validates `photobeaver-plugin.json` in a project folder.
 *
 * @param dir - Plugin project folder.
 * @returns The manifest with defaults applied, or readable errors.
 */
export async function readManifest(dir: string): Promise<ManifestRead> {
  const json = await readJson(path.join(dir, MANIFEST_FILE));
  if ('error' in json) return { ok: false, errors: [json.error] };
  return validateManifest(json.value);
}
