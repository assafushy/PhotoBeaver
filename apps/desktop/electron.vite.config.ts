import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { copyDefaultPlugins } from './build/copy-default-plugins';
import { copyMigrations } from './build/copy-migrations';

import packageJson from './package.json' with { type: 'json' };

const WORKSPACE_PACKAGES = Object.keys(packageJson.devDependencies).filter((name) =>
  name.startsWith('@photobeaver/'),
);

export default defineConfig({
  main: {
    plugins: [copyMigrations(), copyDefaultPlugins()],
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          'plugin-host': fileURLToPath(new URL('./src/plugin-host/index.ts', import.meta.url)),
        },
        output: { chunkFileNames: '[name]-[hash].js' },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    plugins: [react(), tailwindcss()],
  },
});
