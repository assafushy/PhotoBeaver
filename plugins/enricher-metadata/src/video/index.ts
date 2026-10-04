import { open } from 'node:fs/promises';
import type { EnrichmentResult, Logger } from '@photobeaver/plugin-sdk';
import { offsetDateToFloating } from '../floating-time';
import { parseIso6709 } from '../geo';
import {
  toEnrichmentResult,
  type Dimensions,
  type ExifSummary,
  type MetadataFacts,
} from '../result';
import { readMovie, type MovieFacts } from './movie';

const ISO_MEDIA_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/3gpp',
  'video/3gpp2',
]);

const KEY_PREFIX = 'com.apple.quicktime.';
const SUMMARY_KEYS: [string, string][] = [
  ['make', 'make'],
  ['model', 'model'],
  ['software', 'software'],
];

/**
 * Tells whether a video MIME type is an ISO base media file this plugin can parse.
 *
 * @param mime - The MIME type.
 * @returns True for MP4, MOV, M4V and 3GP.
 */
export function isIsoMedia(mime: string | undefined): boolean {
  return mime !== undefined && ISO_MEDIA_TYPES.has(mime.toLowerCase());
}

function videoDimensions(movie: MovieFacts): Dimensions | undefined {
  if (!movie.track) return undefined;
  const { width, height, rotation } = movie.track;
  const turned = rotation === 90 || rotation === 270;
  const size = turned ? { width: height, height: width } : { width, height };
  return movie.durationMs === undefined ? size : { ...size, durationMs: movie.durationMs };
}

function videoSummary(keys: Record<string, string>): ExifSummary {
  const summary: ExifSummary = {};
  for (const [field, key] of SUMMARY_KEYS) {
    const value = keys[`${KEY_PREFIX}${key}`]?.trim();
    if (value) summary[field] = value;
  }
  return summary;
}

/**
 * Turns movie facts into metadata facts. The Apple creation date wins over `mvhd`, and
 * the Apple location wins over `©xyz`.
 *
 * @param movie - What readMovie found.
 * @returns Capture time, location, dimensions with duration, and camera fields.
 */
export function videoFacts(movie: MovieFacts): MetadataFacts {
  return {
    capturedAt: offsetDateToFloating(movie.keys[`${KEY_PREFIX}creationdate`]) ?? movie.createdAt,
    location: parseIso6709(movie.keys[`${KEY_PREFIX}location.ISO6709`]) ?? movie.xyz,
    dimensions: videoDimensions(movie),
    exif: videoSummary(movie.keys),
  };
}

async function readFacts(path: string): Promise<MetadataFacts> {
  const file = await open(path, 'r');
  try {
    return videoFacts(await readMovie(file));
  } finally {
    await file.close();
  }
}

/**
 * Reads metadata from an MP4 or MOV file without loading it into memory.
 *
 * @param path - Path to the original.
 * @param log - Logger for unreadable files.
 * @returns The enrichment result; `{}` when nothing was found or the file is unreadable.
 */
export async function readVideoMetadata(path: string, log: Logger): Promise<EnrichmentResult> {
  try {
    return toEnrichmentResult(await readFacts(path));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('Could not read video metadata', { file: path, error: message });
    return {};
  }
}
