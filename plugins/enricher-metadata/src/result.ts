import type { EnrichmentResult, GeoPoint } from '@photobeaver/plugin-sdk';

export type ExifSummary = Record<string, string | number>;

export interface Dimensions {
  width: number;
  height: number;
  durationMs?: number;
}

export interface MetadataFacts {
  capturedAt?: string;
  location?: GeoPoint;
  dimensions?: Dimensions;
  exif: ExifSummary;
}

/**
 * Builds the search text for a camera: make and model, without repeating the make
 * when the model already starts with it ("Canon" + "Canon EOS R5").
 *
 * @param exif - The EXIF summary.
 * @returns The text, or undefined when neither is known.
 */
export function cameraSearchText(exif: ExifSummary): string | undefined {
  const make = typeof exif.make === 'string' ? exif.make : '';
  const model = typeof exif.model === 'string' ? exif.model : '';
  const repeats = make && model.toLowerCase().startsWith(make.toLowerCase());
  const text = (repeats ? model : `${make} ${model}`).trim();
  return text || undefined;
}

/**
 * Turns what was read from a file into an EnrichmentResult with only the known fields.
 *
 * @param facts - Capture time, location, dimensions and EXIF summary.
 * @returns The result; `{}` when nothing was found.
 */
export function toEnrichmentResult(facts: MetadataFacts): EnrichmentResult {
  const result: EnrichmentResult = {};
  if (facts.capturedAt) result.capturedAt = facts.capturedAt;
  if (facts.location) result.location = facts.location;
  if (facts.dimensions) result.dimensions = facts.dimensions;
  if (Object.keys(facts.exif).length > 0) result.data = { exif: facts.exif };
  const searchText = cameraSearchText(facts.exif);
  if (searchText) result.searchText = searchText;
  return result;
}
