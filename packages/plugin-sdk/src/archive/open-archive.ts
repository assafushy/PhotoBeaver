import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { openLooseFile, walkFolder } from './folder';
import { isZipName } from './paths';
import type { ArchiveEntry, ArchiveTree } from './types';
import { ZipFile } from './zip-file';

interface EntrySource {
  entry: ArchiveEntry;
  open(): Promise<ReadableStream<Uint8Array>>;
}

type Sources = Map<string, EntrySource>;

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function comparePaths(a: ArchiveEntry, b: ArchiveEntry): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

class MergedTree implements ArchiveTree {
  private readonly sorted: ArchiveEntry[];

  constructor(
    readonly root: string,
    private readonly sources: Sources,
    private readonly zips: ZipFile[],
  ) {
    this.sorted = [...sources.values()].map((source) => source.entry).sort(comparePaths);
  }

  entries(): ArchiveEntry[] {
    return [...this.sorted];
  }

  get(path: string): ArchiveEntry | undefined {
    return this.sources.get(path)?.entry;
  }

  has(path: string): boolean {
    return this.sources.has(path);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await readAll(await this.open(path)));
  }

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T;
  }

  async open(path: string): Promise<ReadableStream<Uint8Array>> {
    const source = this.sources.get(path);
    if (!source) throw new Error(`No entry ${path} in archive ${this.root}`);
    return source.open();
  }

  async close(): Promise<void> {
    await closeAll(this.zips);
  }
}

async function closeAll(zips: ZipFile[]): Promise<void> {
  await Promise.allSettled(zips.map((zip) => zip.close()));
}

function addSource(sources: Sources, source: EntrySource): void {
  if (!sources.has(source.entry.path)) sources.set(source.entry.path, source);
}

async function statRoot(root: string): Promise<Stats> {
  try {
    return await stat(root);
  } catch (error) {
    throw new Error(`Archive root ${root} is not available`, { cause: error });
  }
}

async function addFolder(root: string, sources: Sources): Promise<string[]> {
  const { files, zips } = await walkFolder(root);
  for (const file of files) {
    addSource(sources, { entry: file.entry, open: async () => openLooseFile(file.absolute) });
  }
  return zips;
}

async function addZip(path: string, sources: Sources): Promise<ZipFile> {
  const zip = await ZipFile.open(path);
  for (const member of zip.members) {
    const { path: memberPath, size, modifiedAt } = member;
    addSource(sources, {
      entry: { path: memberPath, size, modifiedAt },
      open: () => zip.openMember(member),
    });
  }
  return zip;
}

async function zipPathsFor(root: string, sources: Sources): Promise<string[]> {
  const info = await statRoot(root);
  if (info.isDirectory()) return addFolder(root, sources);
  if (info.isFile() && isZipName(root)) return [root];
  throw new Error(`Archive root ${root} is not a folder or a .zip file`);
}

/**
 * Opens a data export (Google Takeout, Facebook or Instagram download) as one
 * read-only tree. `root` is an extracted folder, a folder holding the downloaded
 * `.zip` parts, a mix of both, or a single `.zip` file. Zips are read in place:
 * nothing is extracted to disk. When a path appears more than once, loose files
 * win over zip members and earlier zips (sorted by path) win over later ones.
 *
 * @param root - Absolute path of the export folder or zip file.
 * @returns The merged tree. Call `close()` to release the zip file handles.
 * @throws Error with "not available" in the message when `root` does not exist.
 */
export async function openArchive(root: string): Promise<ArchiveTree> {
  const sources: Sources = new Map();
  const zips: ZipFile[] = [];
  try {
    for (const path of await zipPathsFor(root, sources)) zips.push(await addZip(path, sources));
  } catch (error) {
    await closeAll(zips);
    throw error;
  }
  return new MergedTree(root, sources, zips);
}
