import type { GeoPoints } from '@photobeaver/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePbEvent } from '../lib/use-pb-event';
import { FilterBar } from '../search/FilterBar';
import { useSettledFilter } from '../search/filter-store';
import { usePhotoMap, type MapFocus } from './use-photo-map';
import { supportsWebGl } from './webgl';

function useGeoPoints() {
  const client = useQueryClient();
  const filter = useSettledFilter();
  usePbEvent('library.changed', () => void client.invalidateQueries({ queryKey: ['geoPoints'] }));
  return useQuery({
    queryKey: ['geoPoints', filter],
    queryFn: () => window.pb.library.geoPoints(filter),
  });
}

function useOnlineTiles(): boolean | undefined {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => window.pb.settings.get() });
  return data === undefined ? undefined : data.mapTileUrl !== null;
}

function useFocus(): MapFocus | null {
  const [params] = useSearchParams();
  const lat = params.get('lat');
  const lon = params.get('lon');
  return useMemo(
    () => (lat !== null && lon !== null ? { lat: Number(lat), lon: Number(lon) } : null),
    [lat, lon],
  );
}

function MapStatus({ count, truncated }: { count: number; truncated: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="text-sm text-neutral-500" data-testid="map-count">
      {t('map.count', { count })}
      {truncated ? ` · ${t('map.truncated')}` : ''}
    </span>
  );
}

function MapUnavailable() {
  const { t } = useTranslation();
  return (
    <p role="status" className="p-8 text-neutral-500" data-testid="map-unavailable">
      {t('map.unavailable')}
    </p>
  );
}

function MapHeader({ data }: { data: GeoPoints | undefined }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <h1 className="text-lg font-semibold">{t('nav.map')}</h1>
      {data && <MapStatus count={data.points.length} truncated={data.truncated} />}
    </header>
  );
}

function MapCanvas({ container, ready }: { container: RefObject<HTMLDivElement>; ready: boolean }) {
  if (!supportsWebGl()) return <MapUnavailable />;
  return (
    <div ref={container} className="relative min-h-0 flex-1" data-testid="map" data-ready={ready} />
  );
}

/**
 * Map screen (SPEC 8.1 #4): geotagged photos under the current filters,
 * clustered; clicking a photo opens it in the viewer.
 */
export function MapPage() {
  const navigate = useNavigate();
  const container = useRef<HTMLDivElement>(null);
  const { data } = useGeoPoints();
  const openAsset = useCallback((id: string) => navigate(`/library/asset/${id}`), [navigate]);
  const online = useOnlineTiles();
  const focus = useFocus();
  const ready = usePhotoMap(container, { online, data, focus, openAsset });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MapHeader data={data} />
      <FilterBar />
      <MapCanvas container={container} ready={ready} />
    </div>
  );
}
