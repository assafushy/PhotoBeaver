import type { AssetDetail } from '@photobeaver/shared';

type Exif = Record<string, string | number | undefined>;

function exifOf(asset: AssetDetail): Exif | null {
  for (const enrichment of asset.enrichments) {
    const exif = enrichment.data.exif;
    if (exif && typeof exif === 'object') return exif as Exif;
  }
  return null;
}

function exposureText(exif: Exif): string {
  const parts = [
    typeof exif.fNumber === 'number' ? `f/${exif.fNumber}` : null,
    typeof exif.exposureTime === 'number'
      ? exif.exposureTime < 1
        ? `1/${Math.round(1 / exif.exposureTime)} s`
        : `${exif.exposureTime} s`
      : null,
    exif.iso ? `ISO ${exif.iso}` : null,
    typeof exif.focalLength === 'number' ? `${exif.focalLength} mm` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function cameraName(exif: Exif): string {
  const make = String(exif.make ?? '');
  const model = String(exif.model ?? '');
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim();
}

/**
 * Camera, lens and exposure from the first enrichment that carries EXIF.
 *
 * @param asset - Asset detail.
 * @returns Display lines, or null when there is no EXIF.
 */
export function cameraLines(
  asset: AssetDetail,
): { camera: string; lens: string; exposure: string } | null {
  const exif = exifOf(asset);
  if (!exif) return null;
  return { camera: cameraName(exif), lens: String(exif.lens ?? ''), exposure: exposureText(exif) };
}

/**
 * Formats an enrichment value for the info panel.
 *
 * @param value - Any JSON value.
 * @returns A short string.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}
