export interface ArchiveEntry {
  /** Posix path relative to the export root, e.g. `Takeout/Google Photos/Trip/IMG_1.jpg`. */
  path: string;
  /** Uncompressed size in bytes. */
  size: number;
  /** ISO 8601 modification time from the file or the zip entry. */
  modifiedAt?: string;
}

export interface ArchiveTree {
  readonly root: string;
  /** All file entries (no directories), sorted by path. */
  entries(): ArchiveEntry[];
  get(path: string): ArchiveEntry | undefined;
  has(path: string): boolean;
  /** Reads a whole entry as UTF-8 text. */
  readText(path: string): Promise<string>;
  /** Reads a whole entry and parses it as JSON. */
  readJson<T>(path: string): Promise<T>;
  /** Streams an entry without buffering it in memory. */
  open(path: string): Promise<ReadableStream<Uint8Array>>;
  /** Releases the open zip file handles. */
  close(): Promise<void>;
}
