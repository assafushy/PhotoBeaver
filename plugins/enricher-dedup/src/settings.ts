export type ExactMergeMode = 'auto' | 'ask';

export interface DedupSettings {
  exactMerge: ExactMergeMode;
  nearDuplicates: boolean;
  nearThreshold: number;
  downloadToCompare: boolean;
}

export const DEFAULT_SETTINGS: DedupSettings = {
  exactMerge: 'auto',
  nearDuplicates: true,
  nearThreshold: 6,
  downloadToCompare: true,
};

const MAX_THRESHOLD = 16;

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function thresholdOr(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(MAX_THRESHOLD, Math.max(0, value));
}

/**
 * Applies the configSchema defaults to raw settings and drops invalid values.
 *
 * @param raw - Settings as returned by `ctx.settings()`, possibly partial.
 * @returns Complete, valid settings.
 */
export function resolveSettings(
  raw: Partial<Record<keyof DedupSettings, unknown>> | undefined,
): DedupSettings {
  const input = raw ?? {};
  return {
    exactMerge: input.exactMerge === 'ask' ? 'ask' : DEFAULT_SETTINGS.exactMerge,
    nearDuplicates: booleanOr(input.nearDuplicates, DEFAULT_SETTINGS.nearDuplicates),
    nearThreshold: thresholdOr(input.nearThreshold, DEFAULT_SETTINGS.nearThreshold),
    downloadToCompare: booleanOr(input.downloadToCompare, DEFAULT_SETTINGS.downloadToCompare),
  };
}
