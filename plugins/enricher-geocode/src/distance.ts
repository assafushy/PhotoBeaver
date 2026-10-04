export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;

const RADIANS = Math.PI / 180;

/**
 * Great-circle distance between two points with the haversine formula.
 *
 * @param lat1 - Latitude of the first point in degrees.
 * @param lon1 - Longitude of the first point in degrees.
 * @param lat2 - Latitude of the second point in degrees.
 * @param lon2 - Longitude of the second point in degrees.
 * @returns Distance in kilometres.
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RADIANS;
  const dLon = (lon2 - lon1) * RADIANS;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RADIANS) * Math.cos(lat2 * RADIANS) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
