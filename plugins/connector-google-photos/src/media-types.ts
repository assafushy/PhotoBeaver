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
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef',
  arw: 'image/x-sony-arw',
  orf: 'image/x-olympus-orf',
  rw2: 'image/x-panasonic-rw2',
  raf: 'image/x-fuji-raf',
};

const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mp: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  mts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Classifies a file by extension.
 *
 * @param filename - File name or path.
 * @returns The media kind and MIME type, or null when the file is not a photo or video.
 */
export function mediaTypeOf(filename: string): MediaType | null {
  const ext = extensionOf(filename);
  const image = IMAGE_TYPES[ext];
  if (image) return { kind: 'image', mime: image };
  const video = VIDEO_TYPES[ext];
  return video ? { kind: 'video', mime: video } : null;
}
