import type { GeoPoint } from '@photobeaver/plugin-sdk';
import { exifOf } from './exif';
import {
  isoFromSeconds,
  isoFromText,
  isRecord,
  numberField,
  textField,
  type JsonRecord,
} from './json';
import type { ExportFile, MediaSource } from './layout';
import { mediaTypeOf } from './media-types';

export interface MediaRef {
  uri: string;
  source: MediaSource;
  capturedAt?: string;
  location?: GeoPoint;
  caption?: string;
}

interface WalkContext {
  source: MediaSource;
  title?: string;
  timestamp?: number;
}

function mediaUri(record: JsonRecord): string | undefined {
  const uri = record['uri'] ?? record['path'];
  if (typeof uri !== 'string' || uri.includes('://')) return undefined;
  return mediaTypeOf(uri) ? uri : undefined;
}

function capturedAtOf(record: JsonRecord, ctx: WalkContext, taken?: number): string | undefined {
  const created = numberField(record, 'creation_timestamp') ?? ctx.timestamp;
  return isoFromSeconds(taken ?? created) ?? isoFromText(record, 'taken_at');
}

function mediaRefOf(record: JsonRecord, uri: string, ctx: WalkContext): MediaRef {
  const exif = exifOf(record['media_metadata']);
  return {
    uri,
    source: ctx.source,
    capturedAt: capturedAtOf(record, ctx, exif.takenTimestamp),
    location: exif.location,
    caption: textField(record, 'title') ?? textField(record, 'caption') ?? ctx.title,
  };
}

function withPost(record: JsonRecord, ctx: WalkContext): WalkContext {
  return {
    ...ctx,
    title: textField(record, 'title') ?? ctx.title,
    timestamp: numberField(record, 'creation_timestamp') ?? ctx.timestamp,
  };
}

function visit(value: unknown, ctx: WalkContext, refs: MediaRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, ctx, refs);
    return;
  }
  if (!isRecord(value)) return;
  const uri = mediaUri(value);
  if (uri) refs.push(mediaRefOf(value, uri, ctx));
  if (uri || typeof value['uri'] === 'string') return;
  const inner = withPost(value, ctx);
  for (const child of Object.values(value)) visit(child, inner, refs);
}

/**
 * Finds every photo or video referenced by one export JSON file. Any object with a
 * media `uri` counts, and a post's title and time apply to the media inside it
 * unless the media has its own (carousel and single posts differ here).
 *
 * @param json - The parsed file.
 * @param file - Where the file sits in the export and which source it describes.
 * @returns One reference per media object, in document order.
 */
export function collectRefs(json: unknown, file: ExportFile): MediaRef[] {
  const refs: MediaRef[] = [];
  visit(json, { source: file.source }, refs);
  return refs;
}
