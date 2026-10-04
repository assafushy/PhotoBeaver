import { describe, expect, it } from 'vitest';
import { validateConfig } from '@photobeaver/shared';
import { validateManifest } from '@photobeaver/shared/manifest';
import raw from '../photobeaver-plugin.json';
import { DEFAULT_SETTINGS, resolveSettings } from '../src/settings';

describe('manifest', () => {
  it('passes validation with the SPEC 9.4 essentials', () => {
    const result = validateManifest(raw);
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    expect(result.manifest).toMatchObject({
      id: 'com.photobeaver.enricher-dedup',
      type: 'enricher',
      default: { enabledOnInstall: true },
      permissions: { originals: 'read', assets: 'merge', network: [], filesystem: 'none' },
      enricher: {
        accepts: ['image/*', 'video/*'],
        input: 'thumbnail',
        dependsOn: ['com.photobeaver.enricher-metadata'],
        produces: ['identity', 'duplicates'],
        resourceClass: 'light',
        concurrency: 1,
        runOn: ['new', 'changed'],
      },
    });
  });

  it('has configSchema defaults equal to the plugin defaults', () => {
    const result = validateConfig(raw.configSchema as never, {});
    expect(result).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS } });
  });
});

describe('settings', () => {
  it('applies defaults and drops invalid values', () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      resolveSettings({ exactMerge: 'nope', nearThreshold: 40, nearDuplicates: 'yes' }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      nearThreshold: 16,
    });
    expect(
      resolveSettings({ exactMerge: 'ask', downloadToCompare: false, nearThreshold: 3 }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      exactMerge: 'ask',
      downloadToCompare: false,
      nearThreshold: 3,
    });
  });
});
