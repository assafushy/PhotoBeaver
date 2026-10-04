import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const PLUGINS_ROOT = fileURLToPath(new URL('../../../plugins', import.meta.url));
const TARGET = fileURLToPath(new URL('../out/main/default-plugins', import.meta.url));
const DEFAULT_PLUGINS = [
  'connector-local',
  'enricher-metadata',
  'enricher-geocode',
  'enricher-dedup',
  'connector-dropbox',
  'connector-onedrive',
  'connector-google-photos',
  'connector-facebook-export',
  'connector-instagram-export',
];
const SHIPPED_ENTRIES = ['photobeaver-plugin.json', 'dist', 'assets', 'README.md', 'LICENSE'];

function copyPlugin(name: string): void {
  const source = path.join(PLUGINS_ROOT, name);
  if (!existsSync(path.join(source, 'dist'))) {
    throw new Error(
      `Default plugin ${name} is not built. Run "pnpm build" (turbo builds plugins first).`,
    );
  }
  for (const entry of SHIPPED_ENTRIES) {
    const from = path.join(source, entry);
    if (existsSync(from)) cpSync(from, path.join(TARGET, name, entry), { recursive: true });
  }
}

/**
 * Copies the built default plugins (SPEC 9.1) next to the main bundle, so the
 * app installs them into userData on first run in dev, e2e and packaged builds.
 *
 * @returns A Vite plugin that copies on every main-process build.
 */
export function copyDefaultPlugins(): Plugin {
  return {
    name: 'photobeaver:copy-default-plugins',
    writeBundle() {
      rmSync(TARGET, { recursive: true, force: true });
      DEFAULT_PLUGINS.forEach(copyPlugin);
    },
  };
}
