import type { AlbumRef } from '@photobeaver/plugin-sdk';
import type { ArchiveEntry } from '@photobeaver/plugin-sdk/archive';
import { isYearFolder, photoFolders, splitPath, type Folder } from './folders';
import { findSidecar } from './sidecar';

export interface TakeoutItem {
  externalId: string;
  entry: ArchiveEntry;
  folder: string;
  sidecar?: string;
  albums: AlbumRef[];
}

interface Catalog {
  items: Map<string, TakeoutItem>;
  byNameAndSize: Map<string, TakeoutItem>;
}

function copyKey(entry: ArchiveEntry): string {
  return `${splitPath(entry.path).name}\u0000${entry.size}`;
}

function sidecarPath(folder: Folder, entry: ArchiveEntry): string | undefined {
  const sidecar = findSidecar(folder.sidecars, splitPath(entry.path).name);
  return sidecar === undefined ? undefined : `${folder.path}/${sidecar}`;
}

function addItem(catalog: Catalog, folder: Folder, entry: ArchiveEntry): TakeoutItem {
  const name = splitPath(folder.path).name;
  const sidecar = sidecarPath(folder, entry);
  const item: TakeoutItem = { externalId: entry.path, entry, folder: name, sidecar, albums: [] };
  catalog.items.set(item.externalId, item);
  if (!catalog.byNameAndSize.has(copyKey(entry))) catalog.byNameAndSize.set(copyKey(entry), item);
  return item;
}

function addAlbumCopy(catalog: Catalog, folder: Folder, entry: ArchiveEntry): void {
  const album = { externalId: folder.path, name: splitPath(folder.path).name };
  const item = catalog.byNameAndSize.get(copyKey(entry)) ?? addItem(catalog, folder, entry);
  item.sidecar ??= sidecarPath(folder, entry);
  if (!item.albums.some((known) => known.externalId === album.externalId)) item.albums.push(album);
}

function byExternalId(a: TakeoutItem, b: TakeoutItem): number {
  return a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0;
}

/**
 * Lists the unique photos and videos of a Google Photos Takeout export. A photo that
 * is in an album folder and in a "Photos from YYYY" folder (matched by file name and
 * size) is one item, identified by its year folder path and listed in the album.
 *
 * @param entries - All archive entries.
 * @returns Items sorted by externalId.
 */
export function buildCatalog(entries: readonly ArchiveEntry[]): TakeoutItem[] {
  const catalog: Catalog = { items: new Map(), byNameAndSize: new Map() };
  const folders = photoFolders(entries);
  const isYear = (folder: Folder) => isYearFolder(splitPath(folder.path).name);
  for (const folder of folders.filter(isYear)) {
    for (const entry of folder.media) addItem(catalog, folder, entry);
  }
  for (const folder of folders.filter((folder) => !isYear(folder))) {
    for (const entry of folder.media) addAlbumCopy(catalog, folder, entry);
  }
  return [...catalog.items.values()].sort(byExternalId);
}

/**
 * Collects the distinct albums of some items.
 *
 * @param items - Catalog items.
 * @returns Albums, each once.
 */
export function albumsOf(items: readonly TakeoutItem[]): AlbumRef[] {
  const albums = new Map<string, AlbumRef>();
  for (const album of items.flatMap((item) => item.albums)) albums.set(album.externalId, album);
  return [...albums.values()];
}
