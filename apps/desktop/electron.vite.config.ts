import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { copyMigrations } from './build/copy-migrations';

const WORKSPACE_PACKAGES = ['@photobeaver/shared', '@photobeaver/db'];

export default defineConfig({
  main: {
    plugins: [copyMigrations()],
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
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
