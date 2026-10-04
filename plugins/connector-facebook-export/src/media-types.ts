import type { MediaKind } from '@photobeaver/plugin-sdk';

export interface MediaType {
  kind: MediaKind;
  mime: string;
}

const MEDIA_TYPES: Record<string, MediaType> = {
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  heic: { kind: 'image', mime: 'image/heic' },
  heif: { kind: 'image', mime: 'image/heif' },
  avif: { kind: 'image', mime: 'image/avif' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  tif: { kind: 'image', mime: 'image/tiff' },
  tiff: { kind: 'image', mime: 'image/tiff' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/x-m4v' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  webm: { kind: 'video', mime: 'video/webm' },
  mkv: { kind: 'video', mime: 'video/x-matroska' },
  avi: { kind: 'video', mime: 'video/x-msvideo' },
  '3gp': { kind: 'video', mime: 'video/3gpp' },
};

function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * Classifies a media file by its extension.
 *
 * @param name - File name, path or export `uri`.
 * @returns The media kind and MIME type, or undefined when the file is not a photo or video.
 */
export function mediaTypeOf(name: string): MediaType | undefined {
  return MEDIA_TYPES[extensionOf(name)];
}
