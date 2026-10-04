import type { PluginStorage } from '@photobeaver/plugin-sdk';
import { parentOf } from './mapping';

interface FolderIndex {
  files: Record<string, string>;
  dirs: Record<string, true>;
}

const emptyIndex = (): FolderIndex => ({ files: {}, dirs: {} });

const isEmpty = (index: FolderIndex): boolean =>
  Object.keys(index.files).length === 0 && Object.keys(index.dirs).length === 0;

/**
 * Maps Dropbox paths to file ids, one storage key per folder. Dropbox reports deletions
 * by path only, so this is how deletes become externalIds, including whole folders.
 * Changes are cached and written with `flush()` once per batch.
 */
export class PathIndex {
  private readonly cache = new Map<string, FolderIndex>();
  private readonly dirty = new Set<string>();

  constructor(
    private readonly storage: PluginStorage,
    private readonly sourceId: string,
  ) {}

  /**
   * Records a file at a lowercased path.
   *
   * @param pathLower - Dropbox `path_lower`.
   * @param id - Dropbox file id.
   */
  async addFile(pathLower: string, id: string): Promise<void> {
    const folder = parentOf(pathLower);
    (await this.edit(folder)).files[pathLower] = id;
    await this.addFolder(folder);
  }

  /**
   * Records a folder and links it into its ancestors.
   *
   * @param pathLower - Dropbox `path_lower` of the folder.
   */
  async addFolder(pathLower: string): Promise<void> {
    if (pathLower === '') return;
    const parent = parentOf(pathLower);
    const index = await this.load(parent);
    if (index.dirs[pathLower]) return;
    (await this.edit(parent)).dirs[pathLower] = true;
    await this.addFolder(parent);
  }

  /**
   * Forgets a deleted file or folder.
   *
   * @param pathLower - Dropbox `path_lower` of the deleted entry.
   * @returns Ids of every file that was at or under that path.
   */
  async remove(pathLower: string): Promise<string[]> {
    if (pathLower === '') return [];
    const parent = await this.edit(parentOf(pathLower));
    const id = parent.files[pathLower];
    delete parent.files[pathLower];
    if (id !== undefined) return [id];
    delete parent.dirs[pathLower];
    return this.dropFolder(pathLower);
  }

  /** Writes every changed folder to storage. */
  async flush(): Promise<void> {
    for (const folder of this.dirty) {
      const index = this.cache.get(folder) ?? emptyIndex();
      const key = this.keyOf(folder);
      await (isEmpty(index) ? this.storage.delete(key) : this.storage.set(key, index));
    }
    this.dirty.clear();
    this.cache.clear();
  }

  private async dropFolder(folder: string): Promise<string[]> {
    const index = await this.load(folder);
    const ids = Object.values(index.files);
    for (const child of Object.keys(index.dirs)) ids.push(...(await this.dropFolder(child)));
    this.cache.set(folder, emptyIndex());
    this.dirty.add(folder);
    return ids;
  }

  private async edit(folder: string): Promise<FolderIndex> {
    const index = await this.load(folder);
    this.dirty.add(folder);
    return index;
  }

  private async load(folder: string): Promise<FolderIndex> {
    const cached = this.cache.get(folder);
    if (cached) return cached;
    const stored = await this.storage.get<FolderIndex>(this.keyOf(folder));
    const index = stored ? { files: { ...stored.files }, dirs: { ...stored.dirs } } : emptyIndex();
    this.cache.set(folder, index);
    return index;
  }

  private keyOf(folder: string): string {
    return `dir:${this.sourceId}:${folder}`;
  }
}
