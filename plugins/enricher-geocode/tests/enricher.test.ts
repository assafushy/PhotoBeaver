import { readFileSync } from 'node:fs';
import type { AssetView } from '@photobeaver/plugin-sdk';
import { createFakeEnrichContext, runEnrich } from '@photobeaver/plugin-sdk/testing';
import { validateManifest } from '@photobeaver/shared/manifest';
import { describe, expect, it } from 'vitest';
import enricher from '../src';

function asset(id: string, location?: { lat: number; lon: number }): AssetView {
  return { id, kind: 'image', mime: 'image/jpeg', location, instances: [], enrichments: {} };
}

describe('enricher-geocode', () => {
  it('has a valid manifest', () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL('../photobeaver-plugin.json', import.meta.url), 'utf8'),
    );
    expect(validateManifest(raw)).toMatchObject({ ok: true });
  });

  it('adds place data, tags and search text', async () => {
    const results = await runEnrich(
      enricher,
      [asset('paris', { lat: 48.8584, lon: 2.2945 })],
      createFakeEnrichContext(),
    );
    const result = results.get('paris')!;
    expect(result.data).toEqual({
      location: expect.objectContaining({ city: 'Paris', country: 'France', countryCode: 'FR' }),
    });
    expect(result.tags?.map((tag) => tag.kind)).toEqual(['place', 'place', 'place']);
    expect(result.tags?.[0]).toEqual({ name: 'Paris', kind: 'place' });
    expect(result.searchText).toMatch(/^Paris .*France$/);
  });

  it('skips assets without a location and returns nothing in the ocean', async () => {
    const assets = [asset('none'), asset('ocean', { lat: 0, lon: -30 })];
    const results = await runEnrich(enricher, assets, createFakeEnrichContext());
    expect(results.has('none')).toBe(false);
    expect(results.get('ocean')).toEqual({});
  });

  it('does not repeat a name used for both city and region', async () => {
    const results = await runEnrich(
      enricher,
      [asset('tokyo', { lat: 35.6812, lon: 139.7671 })],
      createFakeEnrichContext(),
    );
    expect(results.get('tokyo')?.tags?.map((tag) => tag.name)).toEqual(['Tokyo', 'Japan']);
    expect(results.get('tokyo')?.searchText).toBe('Tokyo Japan');
  });
});
