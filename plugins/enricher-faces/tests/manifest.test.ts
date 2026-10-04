import { describe, expect, it } from 'vitest';
import { validateConfig } from '@photobeaver/shared';
import { validateManifest } from '@photobeaver/shared/manifest';
import pkg from '../package.json';
import raw from '../photobeaver-plugin.json';
import { DEFAULT_SETTINGS, resolveSettings } from '../src/settings';

describe('manifest', () => {
  it('passes validation, is off by default and declares native code', () => {
    const result = validateManifest(raw);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    expect(result.manifest).toMatchObject({
      id: 'com.photobeaver.enricher-faces',
      type: 'enricher',
      default: { enabledOnInstall: false },
      permissions: { originals: 'thumbnail', filesystem: 'none', nativeModules: true },
      enricher: {
        accepts: ['image/*'],
        input: 'thumbnail',
        dependsOn: ['com.photobeaver.enricher-metadata'],
        produces: ['faces'],
        resourceClass: 'cpu-heavy',
        concurrency: 1,
      },
      enableNotice: { title: 'Face recognition models' },
    });
    expect(result.manifest.permissions.network).toContain('release-assets.githubusercontent.com');
  });

  it('lists onnxruntime-node as a native dependency', () => {
    expect(pkg.photobeaver.nativeDependencies).toEqual(['onnxruntime-node']);
    expect(pkg.dependencies['onnxruntime-node']).toBeDefined();
  });

  it('has configSchema defaults equal to the plugin defaults', () => {
    expect(validateConfig(raw.configSchema as never, {})).toEqual({
      ok: true,
      value: { ...DEFAULT_SETTINGS },
    });
  });

  it('has no em dashes in user-facing text', () => {
    expect(JSON.stringify(raw)).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('settings', () => {
  it('applies defaults, drops invalid values and clamps to range', () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      resolveSettings({ minFaceSize: 12.5, detectionThreshold: '0.9', clusterDistance: 5 }),
    ).toEqual({ ...DEFAULT_SETTINGS, clusterDistance: 1 });
    expect(resolveSettings({ minFaceSize: 64, minFacesPerPerson: 0 })).toEqual({
      ...DEFAULT_SETTINGS,
      minFaceSize: 64,
      minFacesPerPerson: 1,
    });
  });
});
