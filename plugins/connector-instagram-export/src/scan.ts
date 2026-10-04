import type { Logger, MediaItem } from '@photobeaver/plugin-sdk';
import type { ArchiveTree } from '@photobeaver/plugin-sdk/archive';
import { buildItem, mergeItems } from './items';
import { exportFiles, type ExportFile } from './layout';
import { EntryIndex } from './resolve';
import { collectRefs, type MediaRef } from './walk';

type ItemMap = Map<string, MediaItem>;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function readRefs(tree: ArchiveTree, file: ExportFile, log: Logger): Promise<MediaRef[]> {
  const json = parseJson(await tree.readText(file.path));
  if (json === undefined) {
    log.warn('Skipping export file that is not valid JSON', { file: file.path });
    return [];
  }
  const refs = collectRefs(json, file);
  if (refs.length === 0) log.debug('No photos or videos in export file', { file: file.path });
  return refs;
}

function addRef(items: ItemMap, index: EntryIndex, ref: MediaRef, log: Logger): void {
  const entry = index.resolve(ref.uri);
  if (!entry) {
    log.warn('Skipping media whose file is missing from the export', { uri: ref.uri });
    return;
  }
  const item = buildItem(ref, entry);
  if (!item) return;
  const existing = items.get(item.externalId);
  items.set(item.externalId, existing ? mergeItems(existing, item) : item);
}

function byExternalId(a: MediaItem, b: MediaItem): number {
  return a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0;
}

/**
 * Reads every photo and video described by an Instagram export.
 *
 * @param tree - The opened export.
 * @param log - Logger for skipped files and missing media.
 * @returns One item per media file, sorted by externalId.
 */
export async function scanExport(tree: ArchiveTree, log: Logger): Promise<MediaItem[]> {
  const index = new EntryIndex(tree);
  const items: ItemMap = new Map();
  for (const file of exportFiles(tree)) {
    for (const ref of await readRefs(tree, file, log)) addRef(items, index, ref, log);
  }
  return [...items.values()].sort(byExternalId);
}
