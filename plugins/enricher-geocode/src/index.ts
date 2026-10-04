import { defineEnricher, type EnrichmentResult } from '@photobeaver/plugin-sdk';
import { sharedGeocoder } from './dataset';
import type { Place } from './geocoder';

export { createGeocoder, type Geocoder, type Place } from './geocoder';
export { loadGeocoder } from './dataset';

/**
 * Turns a place into the enrichment result: location data, one place tag per
 * distinct name, and search text.
 *
 * @param place - The place found for an asset.
 * @returns The enrichment result.
 */
export function placeResult(place: Place): EnrichmentResult {
  const names = [...new Set([place.city, place.region, place.country])].filter(
    (name): name is string => !!name,
  );
  return {
    data: { location: place },
    tags: names.map((name) => ({ name, kind: 'place' })),
    searchText: names.join(' '),
  };
}

export default defineEnricher({
  shouldEnrich: (asset) => !!asset.location,

  async enrich(_ctx, asset) {
    if (!asset.location) return {};
    const geocoder = await sharedGeocoder();
    const place = geocoder.lookup(asset.location.lat, asset.location.lon);
    return place ? placeResult(place) : {};
  },
});
