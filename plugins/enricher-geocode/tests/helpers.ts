import type { GeoDataset } from '../src/format';

export interface SyntheticCity {
  name: string;
  lat: number;
  lon: number;
  country: number;
  admin1: number;
  population: number;
}

/**
 * Builds a small in-memory dataset for format and geocoder tests.
 *
 * @param cities - Cities with coordinates in degrees.
 * @returns A dataset with two countries and two admin1 regions.
 */
export function syntheticDataset(cities: SyntheticCity[]): GeoDataset {
  const column = (pick: (city: SyntheticCity) => number): Int32Array =>
    Int32Array.from(cities, pick);
  return {
    countries: [
      { code: 'FR', name: 'France' },
      { code: 'FJ', name: 'Fiji' },
    ],
    admin1: [
      { key: 'FR.11', name: 'Île-de-France' },
      { key: 'FJ.02', name: 'Eastern' },
    ],
    cities: {
      names: cities.map((city) => city.name),
      latE4: column((city) => Math.round(city.lat * 10_000)),
      lonE4: column((city) => Math.round(city.lon * 10_000)),
      country: column((city) => city.country),
      admin1: column((city) => city.admin1),
      population: column((city) => city.population),
    },
  };
}
