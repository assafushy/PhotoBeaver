import type { ArchiveEntry } from '@photobeaver/plugin-sdk/archive';
import { mediaTypeOf } from '../media-types';
import { findSidecar, indexSidecars, type SidecarIndex } from './sidecar';

export interface Folder {
  path: string;
  media: ArchiveEntry[];
  sidecars: SidecarIndex;
}

const YEAR_FOLDER =
  /^(Photos from|Fotos von|Fotos de|Photos de|Foto dal|Foto del|Foto's uit|Fotos fra|Foton från|Zdjęcia z) \d{4}$/u;

/**
 * Splits a posix path into its folder and file name.
 *
 * @param path - Posix path.
 * @returns The folder ("" at the root) and the last segment.
 */
export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1
    ? { dir: '', name: path }
    : { dir: path.slice(0, slash), name: path.slice(slash + 1) };
}

/**
 * Whether a Google Photos folder is a "Photos from YYYY" folder rather than an album.
 *
 * @param name - Folder name.
 * @returns True for year folders, including common localized names.
 */
export function isYearFolder(name: string): boolean {
  return YEAR_FOLDER.test(name);
}

function groupByDir(entries: readonly ArchiveEntry[]): Map<string, ArchiveEntry[]> {
  const groups = new Map<string, ArchiveEntry[]>();
  for (const entry of entries) {
    const { dir } = splitPath(entry.path);
    const group = groups.get(dir);
    if (group) group.push(entry);
    else groups.set(dir, [entry]);
  }
  return groups;
}

function toFolder(path: string, entries: ArchiveEntry[]): Folder {
  const names = entries.map((entry) => splitPath(entry.path).name);
  const media = entries.filter((entry) => mediaTypeOf(entry.path) !== null);
  return { path, media, sidecars: indexSidecars(names) };
}

function hasSidecars(folder: Folder): boolean {
  return folder.media.some((entry) => findSidecar(folder.sidecars, splitPath(entry.path).name));
}

/**
 * Finds the Google Photos album and year folders in an export: folders with media
 * files and their JSON sidecars, plus their sibling folders under the same Google
 * Photos folder (whatever its localized name).
 *
 * @param entries - All archive entries.
 * @returns The folders, sorted by path.
 */
export function photoFolders(entries: readonly ArchiveEntry[]): Folder[] {
  const folders = [...groupByDir(entries)].map(([path, list]) => toFolder(path, list));
  const roots = new Set(folders.filter(hasSidecars).map((folder) => splitPath(folder.path).dir));
  return folders
    .filter((folder) => folder.path !== '' && folder.media.length > 0)
    .filter((folder) => roots.has(splitPath(folder.path).dir))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
