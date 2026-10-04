import type { SyncContext } from '@photobeaver/plugin-sdk';
import type { OneDriveConfig } from './config';
import type { DriveItem } from './types';

export interface FolderNode {
  name: string;
  parentId?: string;
  isRoot?: boolean;
}

export type FolderMap = Record<string, FolderNode>;

const MAX_DEPTH = 256;

type Ctx = SyncContext<OneDriveConfig>;

const storageKey = (ctx: Ctx): string => `folders:${ctx.sourceId}`;

/**
 * Loads the folder tree remembered from earlier delta pages of this source.
 *
 * @param ctx - Sync context.
 * @returns Folder id to node.
 */
export async function loadFolders(ctx: Ctx): Promise<FolderMap> {
  return (await ctx.storage.get<FolderMap>(storageKey(ctx))) ?? {};
}

/**
 * Saves the folder tree for the next sync.
 *
 * @param ctx - Sync context.
 * @param folders - Folder id to node.
 */
export async function saveFolders(ctx: Ctx, folders: FolderMap): Promise<void> {
  await ctx.storage.set(storageKey(ctx), folders);
}

/**
 * Resolves a folder id to its drive-relative path by walking up remembered parents.
 *
 * @param folders - Folder tree.
 * @param id - Folder id.
 * @returns The path ('' for the drive root), or undefined when an ancestor is unknown.
 */
export function folderPath(folders: FolderMap, id: string | undefined): string | undefined {
  const names: string[] = [];
  let node = id === undefined ? undefined : folders[id];
  for (let depth = 0; node && depth < MAX_DEPTH; depth++) {
    if (node.isRoot) return [node.name, ...names.reverse()].filter(Boolean).join('/');
    names.push(node.name);
    node = node.parentId === undefined ? undefined : folders[node.parentId];
  }
  return undefined;
}

function pathFromReference(path: string | undefined): string | undefined {
  const match = path?.match(/^\/drives?(?:\/[^/]+)?\/root:\/?(.*)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1];
  }
}

/**
 * The drive-relative folder that contains an item.
 *
 * @param folders - Folder tree.
 * @param item - Drive item.
 * @returns The folder path, or undefined when it cannot be resolved.
 */
export function parentPathOf(folders: FolderMap, item: DriveItem): string | undefined {
  return (
    folderPath(folders, item.parentReference?.id) ?? pathFromReference(item.parentReference?.path)
  );
}

/**
 * Updates the folder tree from one delta item: adds or moves live folders, forgets deleted ones.
 *
 * @param folders - Folder tree, changed in place.
 * @param item - Drive item.
 */
export function trackFolder(folders: FolderMap, item: DriveItem): void {
  if (!item.folder && !item.root) return;
  if (folders[item.id]?.isRoot) return;
  if (item.deleted) return void delete folders[item.id];
  if (item.root) folders[item.id] = { name: '', isRoot: true };
  else folders[item.id] = { name: item.name ?? '', parentId: item.parentReference?.id };
}

/**
 * Starts a folder tree whose root is the synced folder.
 *
 * @param rootId - Drive item id of the synced folder.
 * @param rootPath - Its drive-relative path.
 * @returns A new folder tree.
 */
export function rootedFolders(rootId: string, rootPath: string): FolderMap {
  return { [rootId]: { name: rootPath, isRoot: true } };
}
