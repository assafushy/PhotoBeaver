import { performance } from 'node:perf_hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGeocoder, type Geocoder } from '../src';

let geocoder: Geocoder;
let loadMs = 0;

beforeAll(async () => {
  const started = performance.now();
  geocoder = await loadGeocoder();
  loadMs = performance.now() - started;
});

describe('reverse geocoding with the bundled dataset', () => {
  it('loads in about a second at most', () => {
    expect(loadMs).toBeLessThan(2000);
  });

  it('finds Paris at the Eiffel Tower', () => {
    expect(geocoder.lookup(48.8584, 2.2945)).toMatchObject({
      city: 'Paris',
      region: expect.stringMatching(/^[IÎ]le-de-France$/),
      country: 'France',
      countryCode: 'FR',
    });
  });

  it('finds Tokyo at Tokyo Station', () => {
    expect(geocoder.lookup(35.6812, 139.7671)).toMatchObject({
      city: 'Tokyo',
      country: 'Japan',
      countryCode: 'JP',
    });
  });

  it('finds Nice on the coast', () => {
    expect(geocoder.lookup(43.695, 7.265)).toMatchObject({ city: 'Nice', country: 'France' });
  });

  it('finds nothing in the middle of the Atlantic', () => {
    expect(geocoder.lookup(0, -30)).toBeNull();
  });

  it('finds Suva in Fiji and crosses the anti-meridian in Chukotka', () => {
    expect(geocoder.lookup(-18.1416, 178.4419)).toMatchObject({ city: 'Suva', countryCode: 'FJ' });
    expect(geocoder.lookup(66.3, 179.95)).toMatchObject({ city: 'Egvekinot', countryCode: 'RU' });
  });

  it('answers a lookup in well under a millisecond', () => {
    const started = performance.now();
    for (let i = 0; i < 1000; i++) geocoder.lookup(-60 + (i % 120), -180 + ((i * 7) % 360));
    expect((performance.now() - started) / 1000).toBeLessThan(0.5);
  });
});
