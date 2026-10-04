import { describe, expect, it } from 'vitest';
import { haversineKm } from '../src/distance';
import { createGeocoder } from '../src/geocoder';
import { buildGrid, forEachNearby } from '../src/grid';
import { syntheticDataset } from './helpers';

function nearby(lat: number, lon: number, radiusKm: number): number[] {
  const grid = buildGrid(
    Float64Array.of(0, 10, -18, -18, 89.9),
    Float64Array.of(0, 10, 179.95, -179.95, 0),
  );
  const found: number[] = [];
  forEachNearby(grid, lat, lon, radiusKm, (i) => found.push(i));
  return found.sort();
}

describe('haversine', () => {
  it('measures known distances', () => {
    expect(haversineKm(48.8566, 2.3522, 51.5074, -0.1278)).toBeCloseTo(343.9, 0);
    expect(haversineKm(0, 179.9, 0, -179.9)).toBeCloseTo(22.2, 1);
  });
});

describe('grid index', () => {
  it('visits only nearby cells', () => {
    expect(nearby(0.5, 0.5, 50)).toEqual([0]);
    expect(nearby(5, 5, 50)).toEqual([]);
  });

  it('wraps around the anti-meridian', () => {
    expect(nearby(-18, 179.99, 50)).toEqual([2, 3]);
    expect(nearby(-18, -179.99, 50)).toEqual([2, 3]);
  });

  it('visits every column near the poles', () => {
    expect(nearby(89.95, 120, 50)).toEqual([4]);
  });
});

describe('geocoder on a synthetic dataset', () => {
  const geocoder = createGeocoder(
    syntheticDataset([
      { name: 'Big', lat: 48.85, lon: 2.35, country: 0, admin1: 0, population: 2_000_000 },
      { name: 'Quarter', lat: 48.87, lon: 2.28, country: 0, admin1: 0, population: 150_000 },
      { name: 'Village', lat: 48.5, lon: 2.0, country: 0, admin1: 0, population: 1_200 },
      { name: 'East', lat: -18, lon: 179.95, country: 1, admin1: 1, population: 500 },
    ]),
  );

  it('prefers the city whose radius contains the point best', () => {
    expect(geocoder.lookup(48.858, 2.295)?.city).toBe('Big');
  });

  it('falls back to the nearest city outside every radius', () => {
    expect(geocoder.lookup(48.52, 2.03)).toMatchObject({
      city: 'Village',
      region: 'Île-de-France',
    });
  });

  it('finds a city across the anti-meridian', () => {
    expect(geocoder.lookup(-18, -179.9)).toMatchObject({ city: 'East', countryCode: 'FJ' });
  });

  it('returns null far from every city and for invalid points', () => {
    expect(geocoder.lookup(0, -30)).toBeNull();
    expect(geocoder.lookup(Number.NaN, 0)).toBeNull();
    expect(geocoder.lookup(91, 0)).toBeNull();
  });
});
