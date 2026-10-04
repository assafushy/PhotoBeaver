import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginType, TemplateValues } from './options';

export interface RenderedFile {
  path: string;
  content: string;
}

const RENAMED_FILES: Record<string, string> = { gitignore: '.gitignore' };

/**
 * The folder holding the templates (works from `src/` and from the bundled `dist/`).
 *
 * @param type - Plugin type.
 * @returns Absolute template folder.
 */
export function templateDir(type: PluginType): string {
  return fileURLToPath(new URL(`../templates/${type}`, import.meta.url));
}

/**
 * Replaces `{{key}}` placeholders. Unknown keys are left as they are.
 *
 * @param text - Template text.
 * @param values - Placeholder values.
 * @returns Rendered text.
 */
export function renderTemplate(text: string, values: TemplateValues): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? values[key as keyof TemplateValues] : match,
  );
}

function listFiles(root: string, relative = ''): string[] {
  return readdirSync(path.join(root, relative)).flatMap((name) => {
    const child = path.posix.join(relative, name);
    return statSync(path.join(root, child)).isDirectory() ? listFiles(root, child) : [child];
  });
}

function outputPath(relative: string): string {
  const base = path.posix.basename(relative);
  const renamed = RENAMED_FILES[base];
  return renamed ? path.posix.join(path.posix.dirname(relative), renamed) : relative;
}

/**
 * Renders every file of a template.
 *
 * @param type - Plugin type.
 * @param values - Placeholder values.
 * @returns Relative output paths with their content.
 */
export function renderTemplateFiles(type: PluginType, values: TemplateValues): RenderedFile[] {
  const root = templateDir(type);
  return listFiles(root).map((relative) => ({
    path: outputPath(relative),
    content: renderTemplate(readFileSync(path.join(root, relative), 'utf8'), values),
  }));
}
