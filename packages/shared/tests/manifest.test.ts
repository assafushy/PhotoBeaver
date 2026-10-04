import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isApiVersionSupported, validateManifest } from '../src';

const base = {
  id: 'com.example.connector-flickr',
  name: 'Flickr',
  version: '1.2.0',
  type: 'connector',
  apiVersion: '1',
  main: 'dist/index.js',
  connector: { syncModes: ['poll'], defaultIntervalSec: 3600 },
};

describe('validateManifest', () => {
  it('accepts the bundled local connector manifest', () => {
    const raw = JSON.parse(
      readFileSync(
        new URL('../../../plugins/connector-local/photobeaver-plugin.json', import.meta.url),
        'utf8',
      ),
    );
    expect(validateManifest(raw).ok).toBe(true);
  });

  it('applies permission defaults', () => {
    const result = validateManifest(base);
    if (!result.ok) throw new Error(result.errors.join());
    expect(result.manifest.permissions).toMatchObject({
      network: [],
      filesystem: 'none',
      oauth: false,
      nativeModules: false,
    });
  });

  it.each([
    [{ id: 'Flickr' }, 'id'],
    [{ version: '1.2' }, 'version'],
    [{ type: 'exporter' }, 'type'],
    [{ main: '../outside.js' }, 'main'],
    [{ main: '/abs/index.js' }, 'main'],
    [{ connector: undefined }, 'connector'],
    [{ permissions: { network: ['http://evil.com/path'] } }, 'permissions.network.0'],
  ])('rejects %o', (patch, field) => {
    const result = validateManifest({ ...base, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain(field);
  });

  it('requires an enricher section for enrichers', () => {
    const result = validateManifest({ ...base, type: 'enricher', connector: undefined });
    expect(result.ok).toBe(false);
  });

  it('knows which API versions are supported', () => {
    expect(isApiVersionSupported('1')).toBe(true);
    expect(isApiVersionSupported('2')).toBe(false);
  });
});
