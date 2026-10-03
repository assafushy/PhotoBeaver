import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '@photobeaver/shared/pbplugin';
import { buildPlugin, packProject, runBuild, runPack } from '../src';
import { cleanupTemp, CONNECTOR_TS, manifestJson, recordingOutput, tempProject } from './helpers';

afterEach(cleanupTemp);

describe('buildPlugin', () => {
  it('bundles src/index.ts into dist/index.js with a sourcemap', async () => {
    const dir = tempProject({ 'src/index.ts': CONNECTOR_TS, 'src/extra.ts': '' });
    const result = await buildPlugin(dir);
    expect(result).toEqual({ ok: true, outfile: path.join(dir, 'dist/index.js') });
    expect(readFileSync(path.join(dir, 'dist/index.js'), 'utf8')).toContain('displayName');
    expect(existsSync(path.join(dir, 'dist/index.js.map'))).toBe(true);
  });

  it('returns readable errors', async () => {
    const dir = tempProject({ 'src/index.ts': 'export default {' });
    const out = recordingOutput();
    expect(await runBuild({ command: 'build', dir, watch: false }, out)).toBe(1);
    expect(out.errors.join('\n')).toMatch(/src\/index\.ts:1:\d+/);
  });
});

describe('packProject', () => {
  it('writes the package and its checksum file', async () => {
    const dir = tempProject({
      'photobeaver-plugin.json': manifestJson(),
      'src/index.ts': CONNECTOR_TS,
    });
    const result = await packProject(dir);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.packagePath).toBe(path.join(dir, 'com.example.test-1.2.3.pbplugin'));
    expect(sha256Hex(readFileSync(result.packagePath))).toBe(result.sha256);
    expect(readFileSync(result.checksumPath, 'utf8')).toBe(
      `${result.sha256}  com.example.test-1.2.3.pbplugin\n`,
    );
  });

  it('stops when the plugin is invalid', async () => {
    const dir = tempProject({
      'photobeaver-plugin.json': manifestJson({ version: 'one' }),
      'src/index.ts': CONNECTOR_TS,
    });
    const out = recordingOutput();
    expect(await runPack({ command: 'pack', dir, watch: false }, out)).toBe(1);
    expect(out.errors.join('\n')).toContain('version');
  });
});
