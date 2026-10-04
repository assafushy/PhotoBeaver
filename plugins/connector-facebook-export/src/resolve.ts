import { fixMojibake, type ArchiveEntry, type ArchiveTree } from '@photobeaver/plugin-sdk/archive';

const MIN_SUFFIX_SEGMENTS = 2;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function segmentsOf(uri: string): string[] {
  return uri
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

function suffixesOf(uri: string): string[] {
  const segments = segmentsOf(uri);
  const keep = Math.min(MIN_SUFFIX_SEGMENTS, segments.length);
  const suffixes: string[] = [];
  for (let start = 0; start <= segments.length - keep && keep > 0; start++) {
    suffixes.push(segments.slice(start).join('/'));
  }
  return suffixes;
}

function candidatesOf(uri: string): string[] {
  const variants = [...new Set([fixMojibake(uri), uri])];
  return variants.flatMap(suffixesOf);
}

/** Looks up export `uri` values among the archive entries. */
export class EntryIndex {
  private readonly byName = new Map<string, string[]>();

  constructor(private readonly tree: ArchiveTree) {
    for (const entry of tree.entries()) {
      const name = baseName(entry.path);
      const paths = this.byName.get(name) ?? [];
      paths.push(entry.path);
      this.byName.set(name, paths);
    }
  }

  /**
   * Resolves a `uri` from the export JSON. Tries the exact path, then entries whose path
   * ends with the uri, then the same with leading uri folders dropped, for exports
   * downloaded in parts or extracted under an extra folder.
   *
   * @param uri - Path as written in the export JSON.
   * @returns The matching entry, or undefined when the file is missing.
   */
  resolve(uri: string): ArchiveEntry | undefined {
    for (const candidate of candidatesOf(uri)) {
      const path = this.find(candidate);
      if (path !== undefined) return this.tree.get(path);
    }
    return undefined;
  }

  private find(suffix: string): string | undefined {
    const paths = this.byName.get(baseName(suffix)) ?? [];
    return paths.find((path) => path === suffix) ?? paths.find((p) => p.endsWith(`/${suffix}`));
  }
}
