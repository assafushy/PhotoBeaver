import type { Point } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap, Marker as MarkerType } from 'maplibre-gl';
import { thumbUrl } from '../library/thumb-store';
import { Marker } from './maplibre';

export const PHOTOS_SOURCE = 'photos';

interface MarkerHandlers {
  openAsset(id: string): void;
}

type PhotoProps = { id?: string; cluster?: boolean; cluster_id?: number; point_count?: number };

function clusterElement(count: number, onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pb-cluster';
  el.dataset.testid = 'map-cluster';
  el.dataset.count = String(count);
  el.textContent = count >= 1000 ? `${Math.round(count / 100) / 10}k` : String(count);
  const size = Math.min(64, 28 + Math.log2(count) * 4);
  el.style.width = el.style.height = `${size}px`;
  el.addEventListener('click', onClick);
  return el;
}

function pointElement(id: string, onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pb-point';
  el.dataset.testid = 'map-point';
  el.dataset.assetId = id;
  const img = document.createElement('img');
  img.src = thumbUrl(id, 256);
  img.alt = '';
  el.append(img);
  el.addEventListener('click', onClick);
  return el;
}

async function zoomInto(map: MapLibreMap, clusterId: number, at: [number, number]): Promise<void> {
  const source = map.getSource<GeoJSONSource>(PHOTOS_SOURCE);
  const zoom = await source?.getClusterExpansionZoom(clusterId);
  if (zoom !== undefined) map.easeTo({ center: at, zoom });
}

function markerKey(props: PhotoProps): string {
  return props.cluster ? `c${props.cluster_id}` : `p${props.id}`;
}

function markerElement(
  map: MapLibreMap,
  props: PhotoProps,
  at: [number, number],
  h: MarkerHandlers,
) {
  return props.cluster
    ? clusterElement(props.point_count ?? 0, () => void zoomInto(map, props.cluster_id!, at))
    : pointElement(props.id!, () => h.openAsset(props.id!));
}

/**
 * Keeps HTML markers in sync with the clustered photo source. HTML markers
 * avoid glyph fonts, which the offline style does not ship, and make clusters
 * reachable by keyboard and tests.
 */
export class ClusterMarkers {
  private shown = new Map<string, MarkerType>();

  constructor(
    private readonly map: MapLibreMap,
    private readonly handlers: MarkerHandlers,
  ) {}

  /**
   * Adds markers for the visible clusters and points and removes the rest.
   */
  update(): void {
    const next = new Map<string, MarkerType>();
    for (const feature of this.map.querySourceFeatures(PHOTOS_SOURCE)) {
      const props = feature.properties as PhotoProps;
      const key = markerKey(props);
      if (next.has(key)) continue;
      next.set(key, this.shown.get(key) ?? this.create(props, feature.geometry as Point));
    }
    for (const [key, marker] of this.shown) if (!next.has(key)) marker.remove();
    this.shown = next;
  }

  /**
   * Removes every marker.
   */
  clear(): void {
    for (const marker of this.shown.values()) marker.remove();
    this.shown.clear();
  }

  private create(props: PhotoProps, point: Point): MarkerType {
    const at = point.coordinates as [number, number];
    const element = markerElement(this.map, props, at, this.handlers);
    return new Marker({ element }).setLngLat(at).addTo(this.map);
  }
}
