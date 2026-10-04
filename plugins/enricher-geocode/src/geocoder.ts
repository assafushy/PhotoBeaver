import { haversineKm } from './distance';
import type { GeoDataset } from './format';
import { buildGrid, forEachNearby, type GridIndex } from './grid';

export const MAX_DISTANCE_KM = 50;
export const KM_PER_SQRT_POPULATION = 0.005;
export const MIN_CITY_RADIUS_KM = 1;

const COORDINATE_SCALE = 10_000;

export interface Place {
  city: string;
  region?: string;
  country: string;
  countryCode: string;
  distanceKm: number;
}

export interface Geocoder {
  lookup(lat: number, lon: number): Place | null;
}

interface Match {
  city: number;
  distanceKm: number;
}

interface Candidates {
  nearest: Match | null;
  inside: (Match & { score: number }) | null;
}

/**
 * Rough radius of a city's built-up area, estimated from its population.
 *
 * @param population - Population from GeoNames (0 when unknown).
 * @returns Radius in kilometres.
 */
export function cityRadiusKm(population: number): number {
  return Math.max(MIN_CITY_RADIUS_KM, KM_PER_SQRT_POPULATION * Math.sqrt(population));
}

function scaledColumn(values: Int32Array): Float64Array {
  return Float64Array.from(values, (value) => value / COORDINATE_SCALE);
}

function consider(found: Candidates, city: number, distanceKm: number, population: number): void {
  if (distanceKm > MAX_DISTANCE_KM) return;
  if (!found.nearest || distanceKm < found.nearest.distanceKm) found.nearest = { city, distanceKm };
  const score = distanceKm / cityRadiusKm(population);
  if (score <= 1 && (!found.inside || score < found.inside.score)) {
    found.inside = { city, distanceKm, score };
  }
}

function bestMatch(dataset: GeoDataset, grid: GridIndex, lat: number, lon: number): Match | null {
  const found: Candidates = { nearest: null, inside: null };
  const population = dataset.cities.population;
  forEachNearby(grid, lat, lon, MAX_DISTANCE_KM, (city) =>
    consider(
      found,
      city,
      haversineKm(lat, lon, grid.lat[city]!, grid.lon[city]!),
      population[city]!,
    ),
  );
  return found.inside ?? found.nearest;
}

function toPlace(dataset: GeoDataset, match: Match): Place {
  const { cities, countries, admin1 } = dataset;
  const country = countries[cities.country[match.city]!];
  return {
    city: cities.names[match.city]!,
    region: admin1[cities.admin1[match.city]!]?.name,
    country: country?.name ?? '',
    countryCode: country?.code ?? '',
    distanceKm: Math.round(match.distanceKm * 10) / 10,
  };
}

function isValidPoint(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/**
 * Creates a reverse geocoder over a dataset. A point gets the city whose
 * estimated built-up radius contains it best (so central Paris is "Paris", not
 * an arrondissement), otherwise the nearest city within {@link MAX_DISTANCE_KM}.
 *
 * @param dataset - Decoded GeoNames dataset.
 * @returns A geocoder whose `lookup` returns null when no city is near.
 */
export function createGeocoder(dataset: GeoDataset): Geocoder {
  const grid = buildGrid(scaledColumn(dataset.cities.latE4), scaledColumn(dataset.cities.lonE4));
  return {
    lookup(lat, lon) {
      if (!isValidPoint(lat, lon)) return null;
      const match = bestMatch(dataset, grid, lat, lon);
      return match ? toPlace(dataset, match) : null;
    },
  };
}
