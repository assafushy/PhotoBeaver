import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PluginManifest } from '@photobeaver/shared/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginStore } from '../../src/main/core/plugins/plugin-store';

describe('PluginStore.installCopy', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pb-store-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('keeps bundled native dependencies but skips the plugin folder node_modules', () => {
    const source = path.join(root, 'src-plugin');
    const write = (file: string) => {
      mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
      writeFileSync(path.join(source, file), 'x');
    };
    [
      'photobeaver-plugin.json',
      'dist/index.js',
      'dist/node_modules/native/index.js',
      'node_modules/dev-only/index.js',
    ].forEach(write);
    const store = new PluginStore({
      pluginsDir: path.join(root, 'plugins'),
      pluginDataDir: path.join(root, 'data'),
      tempDir: path.join(root, 'tmp'),
    });
    const installed = store.installCopy(source, {
      id: 'com.example.native',
      version: '1.0.0',
    } as PluginManifest);
    expect(existsSync(path.join(installed, 'dist/node_modules/native/index.js'))).toBe(true);
    expect(existsSync(path.join(installed, 'node_modules'))).toBe(false);
  });
});
