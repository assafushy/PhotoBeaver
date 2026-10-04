import type { AssetView } from '@photobeaver/plugin-sdk';

export const KEY_PREFIX = {
  size: 'size:',
  src: 'src:',
  sha256: 'sha256:',
  vsample: 'vsample:',
  phash: 'phash:',
  dhash: 'dhash:',
} as const;

export const ALGO = { dropbox: 'dropbox', quickxor: 'quickxor', sha256: 'sha256' } as const;

/**
 * Builds a `src:<algo>:<value>` identity key.
 *
 * @param algo - Hash algorithm name, as connectors report it.
 * @param value - Hash value.
 * @returns The identity key.
 */
export function srcKey(algo: string, value: string): string {
  return `${KEY_PREFIX.src}${algo}:${value}`;
}

/**
 * The `size:` keys for every distinct instance size of an asset.
 *
 * @param asset - The asset.
 * @returns Distinct size keys.
 */
export function sizeKeys(asset: AssetView): string[] {
  const sizes = asset.instances.map((i) => i.sizeBytes).filter((s) => s !== undefined);
  return [...new Set(sizes)].map((size) => `${KEY_PREFIX.size}${size}`);
}

/**
 * The `src:` keys for every instance content hash, plus `sha256:` for sha256 source hashes.
 *
 * @param asset - The asset.
 * @returns Distinct source hash keys.
 */
export function sourceHashKeys(asset: AssetView): string[] {
  const keys = asset.instances.flatMap((instance) => {
    const hash = instance.contentHash;
    if (!hash) return [];
    const key = srcKey(hash.algo, hash.value);
    return hash.algo === ALGO.sha256
      ? [key, `${KEY_PREFIX.sha256}${hash.value.toLowerCase()}`]
      : [key];
  });
  return [...new Set(keys)];
}

/**
 * The largest known instance size of an asset.
 *
 * @param asset - The asset.
 * @returns Size in bytes, or 0 when no instance reports one.
 */
export function largestSize(asset: AssetView): number {
  return Math.max(0, ...asset.instances.map((i) => i.sizeBytes ?? 0));
}
