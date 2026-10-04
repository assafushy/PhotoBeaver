import type { MediaItem } from '@photobeaver/plugin-sdk';
import type { MediaFileMetadata, PickedMediaItem } from './types';

export const PREVIEW_SIZE = 1024;

/**
 * URL of the 1024 px preview of a picked item. Videos get their thumbnail
 * without the play icon overlay.
 *
 * @param item - Picked media item.
 * @returns The sized URL.
 */
export function previewUrl(item: PickedMediaItem): string {
  const size = `=w${PREVIEW_SIZE}-h${PREVIEW_SIZE}`;
  return `${item.mediaFile.baseUrl}${item.type === 'VIDEO' ? `${size}-no` : size}`;
}

function dimension(value: number | string | undefined): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return number !== undefined && Number.isFinite(number) && number > 0 ? number : undefined;
}

function dimensions(meta: MediaFileMetadata | undefined): Pick<MediaItem, 'width' | 'height'> {
  const width = dimension(meta?.width);
  const height = dimension(meta?.height);
  return width && height ? { width, height } : {};
}

/**
 * Maps a picked item to a MediaItem.
 *
 * @param item - Picked media item.
 * @param hasPreview - Whether its preview was saved.
 * @returns The media item.
 */
export function toMediaItem(item: PickedMediaItem, hasPreview: boolean): MediaItem {
  const file = item.mediaFile;
  return {
    externalId: item.id,
    kind: item.type === 'VIDEO' || file.mimeType?.startsWith('video/') ? 'video' : 'image',
    ...(file.mimeType ? { mime: file.mimeType } : {}),
    ...(file.filename ? { filename: file.filename } : {}),
    ...(item.createTime ? { capturedAt: item.createTime } : {}),
    ...dimensions(file.mediaFileMetadata),
    metadata: { preview: hasPreview },
  };
}
