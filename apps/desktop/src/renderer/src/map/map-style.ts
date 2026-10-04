import type { FeatureCollection, Point } from 'geojson';
import type { StyleSpecification } from 'maplibre-gl';
import countries from './countries.json';

export const ONLINE_TILE_URL = 'pb-tiles://tile/{z}/{x}/{y}';

const OFFLINE_LAYERS: StyleSpecification['layers'] = [
  { id: 'water', type: 'background', paint: { 'background-color': '#c9dbe6' } },
  {
    id: 'land',
    type: 'fill',
    source: 'countries',
    paint: { 'fill-color': '#f4f1ea' },
  },
  {
    id: 'borders',
    type: 'line',
    source: 'countries',
    paint: { 'line-color': '#b8b2a5', 'line-width': 0.6 },
  },
];

const ONLINE_LAYERS: StyleSpecification['layers'] = [
  { id: 'tiles', type: 'raster', source: 'tiles' },
];

/**
 * Map style. Offline by default: Natural Earth country outlines bundled with
 * the app, so nothing leaves the machine (SPEC 10). With online tiles enabled,
 * raster tiles come through the `pb-tiles://` proxy in the main process.
 *
 * @param online - Whether the user configured an online tile URL.
 * @returns The MapLibre style.
 */
export function mapStyle(online: boolean): StyleSpecification {
  return {
    version: 8,
    sources: online
      ? { tiles: { type: 'raster', tiles: [ONLINE_TILE_URL], tileSize: 256, maxzoom: 19 } }
      : { countries: { type: 'geojson', data: countries as FeatureCollection } },
    layers: online ? ONLINE_LAYERS : OFFLINE_LAYERS,
  };
}

/**
 * Turns `[id, lat, lon]` tuples into a GeoJSON point collection.
 *
 * @param points - Geotagged assets.
 * @returns Features with the asset id as a property.
 */
export function pointsToGeoJson(
  points: readonly (readonly [string, number, number])[],
): FeatureCollection<Point, { id: string }> {
  return {
    type: 'FeatureCollection',
    features: points.map(([id, lat, lon]) => ({
      type: 'Feature',
      properties: { id },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })),
  };
}
