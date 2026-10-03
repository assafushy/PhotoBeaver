import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateManifest } from '@photobeaver/shared/manifest';
import { parseCreateArgs, scaffoldPlugin, slugify, templateValues } from '../src';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pb-create-'));
  roots.push(root);
  return root;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('scaffoldPlugin', () => {
  it.each(['connector', 'enricher'] as const)('writes a valid %s project', async (type) => {
    const dir = path.join(tempRoot(), 'My Cool_Plugin');
    const result = await scaffoldPlugin({ dir, type });
    const manifest = validateManifest(readJson(path.join(dir, 'photobeaver-plugin.json')));
    expect(manifest.ok && manifest.manifest).toMatchObject({
      id: 'com.example.my-cool-plugin',
      name: 'My Cool Plugin',
      type,
    });
    expect(result.files).toEqual(
      expect.arrayContaining([
        '.gitignore',
        'README.md',
        'package.json',
        'src/index.ts',
        'tests/plugin.test.ts',
        'tsconfig.json',
      ]),
    );
    expect(readFileSync(path.join(dir, 'src/index.ts'), 'utf8')).not.toContain('{{');
  });

  it('uses the connector defaults from the spec', async () => {
    const dir = path.join(tempRoot(), 'flickr');
    await scaffoldPlugin({ dir, id: 'org.acme.flickr', name: 'Flickr' });
    const manifest = readJson(path.join(dir, 'photobeaver-plugin.json'));
    expect(manifest).toMatchObject({
      id: 'org.acme.flickr',
      name: 'Flickr',
      connector: { syncModes: ['poll', 'manual'], defaultIntervalSec: 3600 },
      permissions: { network: [], filesystem: 'none' },
    });
  });

  it('uses file: specifiers when --sdk is a path', async () => {
    const root = tempRoot();
    const dir = path.join(root, 'project');
    await scaffoldPlugin({ dir, sdk: path.join(root, 'repo/packages/plugin-sdk') });
    const pkg = readJson(path.join(dir, 'package.json'));
    expect(pkg.devDependencies).toMatchObject({
      '@photobeaver/plugin-sdk': 'file:../repo/packages/plugin-sdk',
      '@photobeaver/plugin-cli': 'file:../repo/packages/plugin-cli',
    });
  });

  it('uses the version for both packages otherwise', async () => {
    const dir = path.join(tempRoot(), 'project');
    await scaffoldPlugin({ dir, sdk: '^0.2.0' });
    expect(readJson(path.join(dir, 'package.json')).devDependencies).toMatchObject({
      '@photobeaver/plugin-sdk': '^0.2.0',
      '@photobeaver/plugin-cli': '^0.2.0',
    });
  });

  it('refuses a non-empty folder', async () => {
    const dir = tempRoot();
    writeFileSync(path.join(dir, 'keep.txt'), 'x');
    await expect(scaffoldPlugin({ dir })).rejects.toThrow(/not empty/);
    expect(existsSync(path.join(dir, 'package.json'))).toBe(false);
  });

  it('refuses an invalid id without writing anything', async () => {
    const dir = path.join(tempRoot(), 'bad');
    await expect(scaffoldPlugin({ dir, id: 'NotReverseDns' })).rejects.toThrow(/id/);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('arguments and defaults', () => {
  it('parses npm create style arguments', () => {
    expect(parseCreateArgs(['my-dir', '--', '--type', 'enricher', '--name', 'Tagger'])).toEqual({
      ok: true,
      options: { dir: 'my-dir', type: 'enricher', id: undefined, name: 'Tagger', sdk: undefined },
    });
    expect(parseCreateArgs(['x', '--type', 'other']).ok).toBe(false);
    expect(parseCreateArgs([]).ok).toBe(false);
  });

  it('derives names and rejects unsafe display names', () => {
    expect(slugify('__')).toBe('my-plugin');
    expect(() => templateValues({ dir: 'x', name: 'Bad "name"' })).toThrow(/quotes/);
  });
});
