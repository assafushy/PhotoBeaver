import type { GeoPoints } from '@photobeaver/shared';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ClusterMarkers, PHOTOS_SOURCE } from './cluster-markers';
import { MapLibreMap as MapClass } from './maplibre';
import { mapStyle, pointsToGeoJson } from './map-style';

export interface MapFocus {
  lat: number;
  lon: number;
}

const FOCUS_ZOOM = 12;

function addPhotoSource(map: MapLibreMap): void {
  map.addSource(PHOTOS_SOURCE, {
    type: 'geojson',
    data: pointsToGeoJson([]),
    cluster: true,
    clusterRadius: 60,
    clusterMaxZoom: 16,
  });
  map.addLayer({
    id: 'photos-hit',
    type: 'circle',
    source: PHOTOS_SOURCE,
    paint: { 'circle-radius': 0, 'circle-opacity': 0 },
  });
}

const photosLoaded = (map: MapLibreMap): boolean =>
  map.getSource(PHOTOS_SOURCE) !== undefined && map.isSourceLoaded(PHOTOS_SOURCE);

function createMap(container: HTMLElement, online: boolean, focus: MapFocus | null): MapLibreMap {
  return new MapClass({
    container,
    style: mapStyle(online),
    center: focus ? [focus.lon, focus.lat] : [0, 20],
    zoom: focus ? FOCUS_ZOOM : 1.2,
    attributionControl: online ? { compact: true } : false,
  });
}

function boundsOf(points: GeoPoints['points']): LngLatBoundsLike | null {
  if (points.length === 0) return null;
  const lons = points.map((p) => p[2]);
  const lats = points.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

function useMapInstance(
  container: RefObject<HTMLDivElement>,
  online: boolean | undefined,
  focus: MapFocus | null,
  openAsset: (id: string) => void,
) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const open = useRef(openAsset);
  useEffect(() => {
    open.current = openAsset;
  });
  useEffect(() => {
    if (!container.current || online === undefined) return;
    const instance = createMap(container.current, online, focus);
    const markers = new ClusterMarkers(instance, { openAsset: (id) => open.current(id) });
    instance.on('load', () => (addPhotoSource(instance), setMap(instance)));
    instance.on('render', () => photosLoaded(instance) && markers.update());
    return () => (markers.clear(), instance.remove(), setMap(null));
  }, [container, online, focus]);
  return map;
}

function usePhotoData(map: MapLibreMap | null, data: GeoPoints | undefined, fit: boolean) {
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || !data) return;
    map.getSource<GeoJSONSource>(PHOTOS_SOURCE)?.setData(pointsToGeoJson(data.points));
    const bounds = boundsOf(data.points);
    if (fit && bounds && !fitted.current)
      map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 0 });
    fitted.current = true;
  }, [map, data, fit]);
}

/**
 * MapLibre map with clustered photo markers.
 *
 * @param container - Element that hosts the map.
 * @param options - Online tiles flag (undefined while loading), the points,
 *   an optional focus point, and what to do when a photo is clicked.
 * @returns Whether the map has finished loading.
 */
export function usePhotoMap(
  container: RefObject<HTMLDivElement>,
  options: {
    online: boolean | undefined;
    data: GeoPoints | undefined;
    focus: MapFocus | null;
    openAsset(id: string): void;
  },
): boolean {
  const map = useMapInstance(container, options.online, options.focus, options.openAsset);
  usePhotoData(map, options.data, options.focus === null);
  return map !== null;
}
