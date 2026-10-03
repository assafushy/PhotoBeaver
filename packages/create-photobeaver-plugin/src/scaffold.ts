import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateManifest } from '@photobeaver/shared/manifest';
import { MANIFEST_FILE } from '@photobeaver/shared/pbplugin';
import { templateValues, type ScaffoldOptions } from './options';
import { renderTemplateFiles, type RenderedFile } from './render';

export interface ScaffoldResult {
  dir: string;
  id: string;
  files: string[];
}

function assertEmptyDir(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`${dir} is not empty. Pick a new folder.`);
  }
}

function assertValidManifest(files: RenderedFile[]): void {
  const manifest = files.find((file) => file.path === MANIFEST_FILE);
  if (!manifest) throw new Error(`Template has no ${MANIFEST_FILE}`);
  const result = validateManifest(JSON.parse(manifest.content));
  if (!result.ok) throw new Error(`Invalid plugin settings:\n  ${result.errors.join('\n  ')}`);
}

function writeFiles(dir: string, files: RenderedFile[]): void {
  for (const file of files) {
    const target = path.join(dir, ...file.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}

/**
 * Creates a plugin project from the connector or enricher template.
 * Refuses to write into a folder that already has files.
 *
 * @param options - Target folder, type, id, display name and SDK version or path.
 * @returns The absolute folder, plugin id and written files.
 * @throws Error when the folder is not empty or the id or name is invalid.
 */
export async function scaffoldPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const dir = path.resolve(options.dir);
  assertEmptyDir(dir);
  const values = templateValues(options);
  const files = renderTemplateFiles(options.type ?? 'connector', values);
  assertValidManifest(files);
  writeFiles(dir, files);
  return { dir, id: values.id, files: files.map((file) => file.path) };
}
