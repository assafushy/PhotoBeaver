import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { scaffoldPlugin } from 'create-photobeaver-plugin';
import { validateManifest } from '@photobeaver/shared/manifest';
import { unpackPlugin } from '@photobeaver/shared/pbplugin';
import { buildPlugin, checkExportShape, packProject, validateProject } from '../src';

const SDK_DIR = fileURLToPath(new URL('../../plugin-sdk', import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), 'pb-cli-int-'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function scaffoldLinked(): Promise<string> {
  const { dir } = await scaffoldPlugin({ dir: path.join(root, 'sample-connector'), sdk: SDK_DIR });
  const scope = path.join(dir, 'node_modules', '@photobeaver');
  mkdirSync(scope, { recursive: true });
  symlinkSync(SDK_DIR, path.join(scope, 'plugin-sdk'), 'junction');
  return dir;
}

describe('scaffold, build, validate and pack', () => {
  it('produces an installable .pbplugin', async () => {
    const dir = await scaffoldLinked();
    expect(await buildPlugin(dir)).toMatchObject({ ok: true });
    expect(await validateProject(dir)).toMatchObject({ ok: true });
    const packed = await packProject(dir);
    if (!packed.ok) throw new Error(packed.errors.join('\n'));
    const target = path.join(root, 'unpacked');
    const manifest = validateManifest(
      JSON.parse(unpackPlugin(readFileSync(packed.packagePath), target)),
    );
    expect(manifest.ok && manifest.manifest.id).toBe('com.example.sample-connector');
    const main = (await import(pathToFileURL(path.join(target, 'dist/index.js')).href)) as Record<
      string,
      unknown
    >;
    expect(checkExportShape('connector', main)).toEqual([]);
  });
});
