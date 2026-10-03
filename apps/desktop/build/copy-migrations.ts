import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const SOURCE = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));
const TARGET = fileURLToPath(new URL('../out/main/migrations', import.meta.url));

/**
 * Copies the drizzle migrations next to the main bundle so dev, e2e and
 * packaged builds all resolve them from the same relative location.
 *
 * @returns A Vite plugin that copies on every main-process build.
 */
export function copyMigrations(): Plugin {
  return {
    name: 'photobeaver:copy-migrations',
    writeBundle() {
      cpSync(SOURCE, TARGET, { recursive: true });
    },
  };
}
