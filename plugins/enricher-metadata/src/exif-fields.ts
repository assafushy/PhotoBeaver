import type { GeoPoint } from '@photobeaver/plugin-sdk';
import { exifDateToFloating } from './floating-time';
import { gpsToDecimal, validLocation } from './geo';
import type { Dimensions, ExifSummary, MetadataFacts } from './result';

export type ExifTags = Record<string, unknown>;

const SUMMARY_FIELDS: [string, string[]][] = [
  ['make', ['Make']],
  ['model', ['Model']],
  ['lensMake', ['LensMake']],
  ['lens', ['LensModel']],
  ['fNumber', ['FNumber']],
  ['exposureTime', ['ExposureTime']],
  ['iso', ['ISO', 'ISOSpeedRatings', 'PhotographicSensitivity']],
  ['focalLength', ['FocalLength']],
  ['focalLength35mm', ['FocalLengthIn35mmFormat']],
  ['orientation', ['Orientation']],
  ['software', ['Software']],
  ['offsetTime', ['OffsetTimeOriginal']],
];

const DATE_FIELDS: [string, string][] = [
  ['DateTimeOriginal', 'SubSecTimeOriginal'],
  ['CreateDate', 'SubSecTimeDigitized'],
  ['ModifyDate', 'SubSecTime'],
];

function cleanValue(value: unknown): string | number | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'number') return Number.isFinite(first) ? first : undefined;
  if (typeof first !== 'string') return undefined;
  const text = first.replace(/\0/g, '').trim();
  return text || undefined;
}

function firstValue(tags: ExifTags, names: string[]): string | number | undefined {
  for (const name of names) {
    const value = cleanValue(tags[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Picks the camera fields worth keeping (make, model, lens, exposure, orientation...).
 *
 * @param tags - Tags from exifr.
 * @returns Only the fields present in the file.
 */
export function summarizeExif(tags: ExifTags): ExifSummary {
  const summary: ExifSummary = {};
  for (const [key, names] of SUMMARY_FIELDS) {
    const value = firstValue(tags, names);
    if (value !== undefined) summary[key] = value;
  }
  return summary;
}

/**
 * Finds the capture time as floating time: DateTimeOriginal, then CreateDate, then
 * ModifyDate, each with its SubSecTime. Offsets are never applied (D41).
 *
 * @param tags - Tags from exifr, with dates left as strings.
 * @returns An ISO string ending in "Z", or undefined.
 */
export function exifCapturedAt(tags: ExifTags): string | undefined {
  for (const [dateTag, subSecTag] of DATE_FIELDS) {
    const iso = exifDateToFloating(tags[dateTag], tags[subSecTag]);
    if (iso) return iso;
  }
  return undefined;
}

/**
 * Reads the GPS position from GPSLatitude/GPSLongitude and their reference letters.
 *
 * @param tags - Tags from exifr.
 * @returns The point, or undefined when missing, (0, 0) or out of range.
 */
export function exifLocation(tags: ExifTags): GeoPoint | undefined {
  const lat = gpsToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef);
  const lon = gpsToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef);
  return validLocation(lat, lon);
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Reads the image size, swapped when the orientation (5 to 8) rotates it by 90 degrees.
 *
 * @param tags - Tags from exifr.
 * @returns The displayed width and height, or undefined when unknown.
 */
export function exifDimensions(tags: ExifTags): Dimensions | undefined {
  const width = positive(tags.ExifImageWidth) ?? positive(tags.ImageWidth);
  const height = positive(tags.ExifImageHeight) ?? positive(tags.ImageHeight);
  if (width === undefined || height === undefined) return undefined;
  const orientation = Number(tags.Orientation);
  return orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Collects everything this plugin reports from a photo's EXIF tags.
 *
 * @param tags - Tags from exifr.
 * @returns Capture time, location, dimensions and the EXIF summary.
 */
export function imageFacts(tags: ExifTags): MetadataFacts {
  return {
    capturedAt: exifCapturedAt(tags),
    location: exifLocation(tags),
    dimensions: exifDimensions(tags),
    exif: summarizeExif(tags),
  };
}
