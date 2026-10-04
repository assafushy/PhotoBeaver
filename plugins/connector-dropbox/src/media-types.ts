import type { MediaKind } from '@photobeaver/plugin-sdk';

export interface MediaType {
  kind: MediaKind;
  mime: string;
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2',
  nef: 'image/x-nikon-nef',
  arw: 'image/x-sony-arw',
  raf: 'image/x-fuji-raf',
  orf: 'image/x-olympus-orf',
  rw2: 'image/x-panasonic-rw2',
};

const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  webm: 'video/webm',
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Classifies a Dropbox file by extension.
 *
 * @param filename - File name.
 * @returns The media kind and MIME type, or null when the file is not indexed.
 */
export function mediaTypeOf(filename: string): MediaType | null {
  const ext = extensionOf(filename);
  const image = IMAGE_TYPES[ext];
  if (image) return { kind: 'image', mime: image };
  const video = VIDEO_TYPES[ext];
  return video ? { kind: 'video', mime: video } : null;
}
