import { readFile } from 'node:fs/promises';
import { unpackDataset } from './format';
import { createGeocoder, type Geocoder } from './geocoder';

export const DATASET_URL = new URL('../assets/cities.bin.gz', import.meta.url);

let shared: Promise<Geocoder> | undefined;

/**
 * Reads a packed dataset file and builds a geocoder over it.
 *
 * @param url - File URL of a `cities.bin.gz` dataset.
 * @returns The geocoder.
 */
export async function loadGeocoder(url: URL = DATASET_URL): Promise<Geocoder> {
  return createGeocoder(unpackDataset(await readFile(url)));
}

/**
 * The plugin's geocoder over its bundled dataset, loaded on first use and then
 * kept in memory. A failed load is retried on the next call.
 *
 * @returns The shared geocoder.
 */
export function sharedGeocoder(): Promise<Geocoder> {
  shared ??= loadGeocoder().catch((error: unknown) => {
    shared = undefined;
    throw error;
  });
  return shared;
}
