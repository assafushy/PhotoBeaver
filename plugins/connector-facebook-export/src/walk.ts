import type { AlbumRef, GeoPoint } from '@photobeaver/plugin-sdk';
import { exifOf } from './exif';
import { isoFromSeconds, isRecord, numberField, textField, type JsonRecord } from './json';
import type { ExportFile } from './layout';
import { mediaTypeOf } from './media-types';

export type MediaSource = 'post' | 'album';

export interface MediaRef {
  uri: string;
  source: MediaSource;
  capturedAt?: string;
  location?: GeoPoint;
  caption?: string;
  album?: AlbumRef;
}

interface WalkContext {
  album?: AlbumRef;
  postText?: string;
  timestamp?: number;
}

function mediaUri(record: JsonRecord): string | undefined {
  const uri = record['uri'];
  if (typeof uri !== 'string' || uri.includes('://')) return undefined;
  return mediaTypeOf(uri) ? uri : undefined;
}

function captionOf(record: JsonRecord, ctx: WalkContext): string | undefined {
  const title = textField(record, 'title');
  const usableTitle = title === ctx.album?.name ? undefined : title;
  return textField(record, 'description') ?? ctx.postText ?? usableTitle;
}

function mediaRefOf(record: JsonRecord, uri: string, ctx: WalkContext): MediaRef {
  const exif = exifOf(record['media_metadata']);
  const created = numberField(record, 'creation_timestamp') ?? ctx.timestamp;
  return {
    uri,
    source: ctx.album ? 'album' : 'post',
    capturedAt: isoFromSeconds(exif.takenTimestamp ?? created),
    location: exif.location,
    caption: captionOf(record, ctx),
    album: ctx.album,
  };
}

function postTextOf(record: JsonRecord): string | undefined {
  const data = record['data'];
  if (!Array.isArray(data)) return undefined;
  return data
    .filter(isRecord)
    .map((row) => textField(row, 'post'))
    .find((text) => text !== undefined);
}

function withPost(record: JsonRecord, ctx: WalkContext): WalkContext {
  return {
    ...ctx,
    postText: postTextOf(record) ?? ctx.postText,
    timestamp: numberField(record, 'timestamp') ?? ctx.timestamp,
  };
}

function visit(value: unknown, ctx: WalkContext, refs: MediaRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, ctx, refs);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value['uri'] === 'string') {
    const uri = mediaUri(value);
    if (uri) refs.push(mediaRefOf(value, uri, ctx));
    return;
  }
  const inner = withPost(value, ctx);
  for (const child of Object.values(value)) visit(child, inner, refs);
}

function rootContext(json: unknown, file: ExportFile): WalkContext {
  if (file.kind !== 'album' || !isRecord(json)) return {};
  const name = textField(json, 'name');
  return name ? { album: { externalId: file.path, name } } : {};
}

/**
 * Finds every photo or video referenced by one export JSON file. Any object with a
 * media `uri` counts, so new or unknown wrappers around media objects still work.
 *
 * @param json - The parsed file.
 * @param file - Where the file sits in the export and what kind it is.
 * @returns One reference per media object, in document order.
 */
export function collectRefs(json: unknown, file: ExportFile): MediaRef[] {
  const refs: MediaRef[] = [];
  visit(json, rootContext(json, file), refs);
  return refs;
}
