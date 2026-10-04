import exifr from 'exifr';
import type { EnrichmentResult, Logger } from '@photobeaver/plugin-sdk';
import { imageFacts, type ExifTags } from './exif-fields';
import { toEnrichmentResult } from './result';

const EXIFR_OPTIONS = {
  chunked: true,
  tiff: true,
  exif: true,
  gps: true,
  ifd1: false,
  interop: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
  makerNote: false,
  userComment: false,
  translateKeys: true,
  translateValues: false,
  reviveValues: false,
  mergeOutput: true,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function parseTags(file: string, log: Logger): Promise<ExifTags | undefined> {
  try {
    const tags: unknown = await exifr.parse(file, EXIFR_OPTIONS);
    return tags && typeof tags === 'object' ? (tags as ExifTags) : undefined;
  } catch (error) {
    log.warn('Could not read photo metadata', { file, error: errorMessage(error) });
    return undefined;
  }
}

/**
 * Reads EXIF from a photo on disk. exifr reads only the header chunks it needs.
 *
 * @param file - Path to the original.
 * @param log - Logger for unreadable files.
 * @returns The enrichment result; `{}` when there is no metadata or the file is unreadable.
 */
export async function readImageMetadata(file: string, log: Logger): Promise<EnrichmentResult> {
  const tags = await parseTags(file, log);
  return tags ? toEnrichmentResult(imageFacts(tags)) : {};
}
