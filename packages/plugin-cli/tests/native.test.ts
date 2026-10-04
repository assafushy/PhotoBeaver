import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { unpackPlugin } from '@photobeaver/shared/pbplugin';
import {
  buildPlugin,
  DEFAULT_PRUNE_RULES,
  keepTargetBinaries,
  nativeTarget,
  packProject,
  readNativeDependencies,
  runValidate,
  validateProject,
  watchPlugin,
  type BuildResult,
  type NativeCopyOptions,
} from '../src';
import { cleanupTemp, manifestJson, recordingOutput, tempProject } from './helpers';

afterEach(cleanupTemp);

const NATIVE_OPTIONS: NativeCopyOptions = {
  pruneRules: { 'fake-native': keepTargetBinaries('bin/napi-v6') },
  target: { platform: 'testos', arch: 'testarch' },
};

const PLUGIN_TS = `import fake from 'fake-native';
const plugin = {
  async setupSource() { return { displayName: fake.hello() }; },
  async *sync() {},
  async getOriginal() { return new ReadableStream(); },
};
export default plugin;
`;

const FAKE_NATIVE_JS = `const common = require('fake-common');
module.exports = { hello: () => 'native', common: () => common.name };
`;

function fakeStore(): string {
  const placeholder = 'not a real binary';
  return tempProject({
    'node_modules/fake-native/package.json': JSON.stringify({
      name: 'fake-native',
      main: 'index.js',
      dependencies: { 'fake-common': '1.0.0' },
    }),
    'node_modules/fake-native/index.js': FAKE_NATIVE_JS,
    'node_modules/fake-native/bin/napi-v6/testos/testarch/fake.node': placeholder,
    'node_modules/fake-native/bin/napi-v6/testos/otherarch/fake.node': placeholder,
    'node_modules/fake-native/bin/napi-v6/otheros/testarch/fake.node': placeholder,
    'node_modules/fake-native/node_modules/junk/index.js': '',
    'node_modules/fake-common/package.json': JSON.stringify({ name: 'fake-common' }),
    'node_modules/fake-common/index.js': "module.exports = { name: 'common' };",
  });
}

function nativePlugin(nativeModules = true, deps: string[] = ['fake-native']): string {
  const dir = tempProject({
    'photobeaver-plugin.json': manifestJson({ permissions: { nativeModules } }),
    'package.json': JSON.stringify({ name: 'p', photobeaver: { nativeDependencies: deps } }),
    'src/index.ts': PLUGIN_TS,
  });
  mkdirSync(path.join(dir, 'node_modules'));
  const linked = path.join(fakeStore(), 'node_modules', 'fake-native');
  symlinkSync(linked, path.join(dir, 'node_modules', 'fake-native'), 'junction');
  return dir;
}

function distPath(dir: string, ...parts: string[]): string {
  return path.join(dir, 'dist', ...parts);
}

describe('native dependencies in pb-plugin build', () => {
  it('keeps the native package external and copies it with its dependencies', async () => {
    const dir = nativePlugin();
    expect(await buildPlugin(dir, NATIVE_OPTIONS)).toMatchObject({ ok: true });
    const bundle = readFileSync(distPath(dir, 'index.js'), 'utf8');
    expect(bundle).toMatch(/from "fake-native"/);
    expect(bundle).not.toContain("'native'");
    expect(lstatSync(distPath(dir, 'node_modules/fake-native')).isSymbolicLink()).toBe(false);
    expect(existsSync(distPath(dir, 'node_modules/fake-native/index.js'))).toBe(true);
    expect(existsSync(distPath(dir, 'node_modules/fake-common/index.js'))).toBe(true);
    expect(existsSync(distPath(dir, 'node_modules/fake-native/node_modules'))).toBe(false);
  });

  it('prunes binaries for other platforms and architectures', async () => {
    const dir = nativePlugin();
    await buildPlugin(dir, NATIVE_OPTIONS);
    const bin = distPath(dir, 'node_modules/fake-native/bin/napi-v6');
    expect(existsSync(path.join(bin, 'testos/testarch/fake.node'))).toBe(true);
    expect(existsSync(path.join(bin, 'testos/otherarch'))).toBe(false);
    expect(existsSync(path.join(bin, 'otheros'))).toBe(false);
  });

  it('produces a bundle that loads the CommonJS native package at runtime', async () => {
    const dir = nativePlugin();
    await buildPlugin(dir, NATIVE_OPTIONS);
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(distPath(dir, 'index.js')).href
    )) as {
      default: { setupSource(): Promise<{ displayName: string }> };
    };
    expect(await mod.default.setupSource()).toEqual({ displayName: 'native' });
  });

  it('copies native packages in watch mode', async () => {
    const dir = nativePlugin();
    let onFirstBuild: (result: BuildResult) => void = () => undefined;
    const first = new Promise<BuildResult>((resolve) => (onFirstBuild = resolve));
    const stop = await watchPlugin(dir, (result) => onFirstBuild(result), NATIVE_OPTIONS);
    expect(await first).toMatchObject({ ok: true });
    await stop();
    expect(existsSync(distPath(dir, 'node_modules/fake-native/index.js'))).toBe(true);
  });

  it('reports a native package that is not installed', async () => {
    const dir = tempProject({
      'package.json': JSON.stringify({ photobeaver: { nativeDependencies: ['not-there'] } }),
      'src/index.ts': 'export default {};',
    });
    expect(await buildPlugin(dir)).toEqual({
      ok: false,
      errors: [expect.stringContaining('cannot find "not-there"')],
    });
  });
});

describe('native dependency declarations', () => {
  it('reads names and rejects anything that is not a package name list', () => {
    const ok = tempProject({
      'package.json': JSON.stringify({ photobeaver: { nativeDependencies: ['@a/b', 'c'] } }),
    });
    expect(readNativeDependencies(ok)).toEqual(['@a/b', 'c']);
    expect(readNativeDependencies(tempProject())).toEqual([]);
    const bad = tempProject({
      'package.json': JSON.stringify({ photobeaver: { nativeDependencies: ['../evil'] } }),
    });
    expect(() => readNativeDependencies(bad)).toThrow(/must be an array of npm package names/);
  });

  it('has a built-in rule for onnxruntime-node and honors target overrides', () => {
    expect(DEFAULT_PRUNE_RULES['onnxruntime-node']).toBeTypeOf('function');
    const env = { PB_PLUGIN_TARGET_PLATFORM: 'win32', PB_PLUGIN_TARGET_ARCH: 'arm64' };
    expect(nativeTarget(env)).toEqual({ platform: 'win32', arch: 'arm64' });
    expect(nativeTarget({})).toEqual({ platform: process.platform, arch: process.arch });
  });
});

describe('nativeModules permission', () => {
  it('validate refuses native dependencies without permissions.nativeModules', async () => {
    const dir = nativePlugin(false);
    await buildPlugin(dir, NATIVE_OPTIONS);
    const out = recordingOutput();
    expect(await runValidate({ command: 'validate', dir, watch: false }, out)).toBe(1);
    expect(out.errors.join('\n')).toContain(
      'permissions.nativeModules: package.json declares native dependencies (fake-native)',
    );
  });

  it('validate warns when nativeModules is set but nothing is declared', async () => {
    const dir = nativePlugin(true, []);
    await buildPlugin(dir, NATIVE_OPTIONS);
    const out = recordingOutput();
    expect(await runValidate({ command: 'validate', dir, watch: false }, out)).toBe(0);
    expect(out.errors).toEqual([expect.stringMatching(/^Warning: permissions.nativeModules/)]);
  });

  it('pack refuses a mismatch and ships dist/node_modules otherwise', async () => {
    const refused = await packProject(nativePlugin(false), NATIVE_OPTIONS);
    expect(refused.ok).toBe(false);
    const packed = await packProject(nativePlugin(true), NATIVE_OPTIONS);
    if (!packed.ok) throw new Error(packed.errors.join('\n'));
    const out = tempProject();
    unpackPlugin(readFileSync(packed.packagePath), out);
    expect(existsSync(distPath(out, 'node_modules/fake-native/index.js'))).toBe(true);
    expect(existsSync(distPath(out, 'node_modules/fake-common/index.js'))).toBe(true);
    expect((await validateProject(out)).ok).toBe(true);
  });
});
