import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { PluginManifest } from '@photobeaver/shared/manifest';
import { readManifest } from './plugin-store';

export interface BundledPlugin {
  dir: string;
  manifest: PluginManifest;
}

/**
 * Compares two semantic versions by major, minor and patch (prerelease ignored).
 *
 * @param a - Version.
 * @param b - Version.
 * @returns Negative, zero or positive.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[-+]/)[0]!.split('.').map(Number);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Lists the default plugins shipped with the app (SPEC 9.1), skipping invalid ones.
 *
 * @param root - Folder with one subfolder per bundled plugin.
 * @returns Bundled plugins with their manifests.
 */
export function bundledPlugins(root: string): BundledPlugin[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const dir = path.join(root, name);
    try {
      return [{ dir, manifest: readManifest(dir) }];
    } catch {
      return [];
    }
  });
}
