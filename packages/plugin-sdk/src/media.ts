export type MediaKind = 'image' | 'video';

export interface ContentHash {
  algo: string;
  value: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface AlbumRef {
  externalId: string;
  name: string;
}

export interface MediaItem {
  externalId: string;
  kind: MediaKind;
  mime?: string;
  filename?: string;
  path?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  capturedAt?: string;
  modifiedAt?: string;
  etag?: string;
  contentHash?: ContentHash;
  externalUrl?: string;
  location?: GeoPoint;
  caption?: string;
  albums?: AlbumRef[];
  metadata?: Record<string, unknown>;
}

export interface ItemRef {
  sourceId: string;
  externalId: string;
  metadata?: Record<string, unknown>;
}

export interface SyncProgress {
  done: number;
  total?: number;
  message?: string;
}

export interface SyncBatch {
  upserts?: MediaItem[];
  deletes?: string[];
  albums?: AlbumRef[];
  cursor: string;
  progress?: SyncProgress;
  isFullScan?: boolean;
}
