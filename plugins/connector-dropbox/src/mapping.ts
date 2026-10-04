import type { MediaItem } from '@photobeaver/plugin-sdk';
import { mediaTypeOf } from './media-types';
import type { DropboxEntry, DropboxFile } from './types';

const HOME_URL = 'https://www.dropbox.com/home';

/**
 * Parent folder of a Dropbox path.
 *
 * @param path - A path such as "/a/b.jpg".
 * @returns "/a", or "" for items in the root.
 */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '' : path.slice(0, slash);
}

/**
 * Link to a folder in the Dropbox web app.
 *
 * @param folder - Display path of the folder, "" for the root.
 * @returns The URL.
 */
export function folderUrl(folder: string): string {
  return HOME_URL + folder.split('/').map(encodeURIComponent).join('/');
}

/**
 * Checks for a file entry with a media extension.
 *
 * @param entry - Any list_folder entry.
 * @returns True for indexed files.
 */
export function isMediaFile(entry: DropboxEntry): entry is DropboxFile {
  return entry['.tag'] === 'file' && mediaTypeOf(entry.name) !== null;
}

/**
 * Maps a Dropbox file to a MediaItem.
 *
 * @param file - A media file entry.
 * @returns The item.
 */
export function toMediaItem(file: DropboxFile): MediaItem {
  const type = mediaTypeOf(file.name)!;
  const folder = parentOf(file.path_display);
  return {
    externalId: file.id,
    kind: type.kind,
    mime: type.mime,
    filename: file.name,
    path: folder === '' ? '/' : folder,
    sizeBytes: file.size,
    modifiedAt: file.server_modified,
    etag: file.rev,
    ...(file.content_hash ? { contentHash: { algo: 'dropbox', value: file.content_hash } } : {}),
    externalUrl: folderUrl(folder),
  };
}
