import type { MediaKind } from '@photobeaver/plugin-sdk';
import type { DriveItem } from './types';

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'avif',
  'tif',
  'tiff',
  'bmp',
  'dng',
  'cr2',
  'cr3',
  'nef',
  'arw',
  'orf',
  'rw2',
  'raf',
  'srw',
  'pef',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mov',
  'avi',
  'mkv',
  'webm',
  'mts',
  'm2ts',
  '3gp',
  'wmv',
  'mpg',
  'mpeg',
]);

function extensionOf(name: string | undefined): string {
  const dot = name?.lastIndexOf('.') ?? -1;
  return dot < 0 ? '' : name!.slice(dot + 1).toLowerCase();
}

function kindFromMime(mime: string | undefined): MediaKind | null {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  return null;
}

function kindFromExtension(name: string | undefined): MediaKind | null {
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

/**
 * Decides whether a drive item is a photo or video, from Graph facets, MIME type or extension.
 *
 * @param item - Drive item from Graph.
 * @returns The media kind, or null for folders and other files.
 */
export function mediaKindOf(item: DriveItem): MediaKind | null {
  if (!item.file || item.deleted) return null;
  if (item.video) return 'video';
  if (item.photo || item.image) return 'image';
  return kindFromMime(item.file.mimeType) ?? kindFromExtension(item.name);
}
