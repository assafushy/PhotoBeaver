import type { GeoPoint, MediaItem } from '@photobeaver/plugin-sdk';

interface TakeoutGeo {
  latitude?: number;
  longitude?: number;
}

export interface TakeoutSidecar {
  title?: string;
  description?: string;
  url?: string;
  photoTakenTime?: { timestamp?: string | number };
  geoData?: TakeoutGeo;
  geoDataExif?: TakeoutGeo;
}

export type SidecarFields = Pick<
  MediaItem,
  'capturedAt' | 'location' | 'caption' | 'externalUrl'
> & {
  title?: string;
};

const PHOTOS_URL = 'https://photos.google.com/';

function capturedAt(sidecar: TakeoutSidecar): string | undefined {
  const seconds = Number(sidecar.photoTakenTime?.timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : undefined;
}

function toPoint(geo: TakeoutGeo | undefined): GeoPoint | undefined {
  const lat = geo?.latitude;
  const lon = geo?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return undefined;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}

function text(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

function photosUrl(value: unknown): string | undefined {
  const url = text(value);
  return url?.startsWith(PHOTOS_URL) ? url : undefined;
}

/**
 * Reads the fields Photo Beaver uses from a Takeout JSON sidecar. A location of
 * 0,0 means "no location"; `geoData` wins over `geoDataExif`.
 *
 * @param sidecar - Parsed sidecar JSON.
 * @returns The fields that are present.
 */
export function sidecarFields(sidecar: TakeoutSidecar): SidecarFields {
  const fields: SidecarFields = {
    capturedAt: capturedAt(sidecar),
    location: toPoint(sidecar.geoData) ?? toPoint(sidecar.geoDataExif),
    caption: text(sidecar.description),
    externalUrl: photosUrl(sidecar.url),
    title: text(sidecar.title),
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as SidecarFields;
}
