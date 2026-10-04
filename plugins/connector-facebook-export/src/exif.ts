import type { GeoPoint } from '@photobeaver/plugin-sdk';
import { isRecord, numberField, type JsonRecord } from './json';

export interface ExifSummary {
  takenTimestamp?: number;
  location?: GeoPoint;
}

function exifRows(mediaMetadata: unknown): JsonRecord[] {
  if (!isRecord(mediaMetadata)) return [];
  return Object.values(mediaMetadata).flatMap((group) => {
    const rows = isRecord(group) ? group['exif_data'] : undefined;
    return Array.isArray(rows) ? rows.filter(isRecord) : [];
  });
}

function locationOf(row: JsonRecord): GeoPoint | undefined {
  const lat = numberField(row, 'latitude');
  const lon = numberField(row, 'longitude');
  if (lat === undefined || lon === undefined) return undefined;
  if (lat === 0 && lon === 0) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

function firstTaken(rows: JsonRecord[]): number | undefined {
  for (const row of rows) {
    const taken = numberField(row, 'taken_timestamp');
    if (taken !== undefined && taken > 0) return taken;
  }
  return undefined;
}

/**
 * Summarizes the EXIF rows of a media object's `media_metadata`.
 *
 * @param mediaMetadata - The `media_metadata` value (photo or video metadata).
 * @returns The first capture time and the first usable GPS point, when present.
 */
export function exifOf(mediaMetadata: unknown): ExifSummary {
  const rows = exifRows(mediaMetadata);
  const location = rows.map(locationOf).find((point) => point !== undefined);
  return { takenTimestamp: firstTaken(rows), location };
}
