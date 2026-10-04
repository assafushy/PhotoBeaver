export interface FacesSettings {
  minFaceSize: number;
  detectionThreshold: number;
  clusterDistance: number;
  minFacesPerPerson: number;
}

export const DEFAULT_SETTINGS: FacesSettings = {
  minFaceSize: 40,
  detectionThreshold: 0.7,
  clusterDistance: 0.5,
  minFacesPerPerson: 3,
};

interface Range {
  min: number;
  max: number;
  integer: boolean;
}

const RANGES: Record<keyof FacesSettings, Range> = {
  minFaceSize: { min: 8, max: 1024, integer: true },
  detectionThreshold: { min: 0.1, max: 0.99, integer: false },
  clusterDistance: { min: 0.1, max: 1, integer: false },
  minFacesPerPerson: { min: 1, max: 50, integer: true },
};

function numberOr(value: unknown, fallback: number, range: Range): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (range.integer && !Number.isInteger(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * Applies the configSchema defaults to raw settings and clamps values into range.
 *
 * @param raw - Settings as returned by `ctx.settings()`, possibly partial.
 * @returns Complete, valid settings.
 */
export function resolveSettings(
  raw: Partial<Record<keyof FacesSettings, unknown>> | undefined,
): FacesSettings {
  const input = raw ?? {};
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof FacesSettings)[];
  const entries = keys.map((key) => [
    key,
    numberOr(input[key], DEFAULT_SETTINGS[key], RANGES[key]),
  ]);
  return Object.fromEntries(entries) as FacesSettings;
}
