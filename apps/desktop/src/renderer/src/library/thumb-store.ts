import { create } from 'zustand';

interface ThumbVersions {
  versions: Record<string, number>;
  bump(ids: readonly string[]): void;
}

/**
 * Per-asset cache-busting counters, bumped when a thumbnail is (re)generated so
 * tiles reload `pb-media://thumb/...` instead of showing a stale 404.
 */
export const useThumbVersions = create<ThumbVersions>((set) => ({
  versions: {},
  bump: (ids) =>
    set((state) => {
      const versions = { ...state.versions };
      for (const id of ids) versions[id] = (versions[id] ?? 0) + 1;
      return { versions };
    }),
}));

/**
 * Thumbnail URL for an asset.
 *
 * @param assetId - Asset id.
 * @param size - 256 or 1024.
 * @param version - Cache-busting counter.
 * @returns The `pb-media://` URL.
 */
export function thumbUrl(assetId: string, size: 256 | 1024, version = 0): string {
  return `pb-media://thumb/${assetId}/${size}${version ? `?v=${version}` : ''}`;
}

export const originalUrl = (assetId: string): string => `pb-media://original/${assetId}`;
