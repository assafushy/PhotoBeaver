import type { LibraryFilter } from '@photobeaver/shared';
import { create } from 'zustand';
import { useDebounced } from './use-debounced';

type MediaType = 'image' | 'video';

interface FilterState {
  filter: LibraryFilter;
  setText(text: string): void;
  toggleMediaType(type: MediaType): void;
  toggleFlag(flag: 'favoritesOnly' | 'multiSource'): void;
  setList(key: 'sourceIds' | 'tagIds' | 'personIds', ids: string[]): void;
  clear(): void;
}

function withoutEmpty(filter: LibraryFilter): LibraryFilter {
  return Object.fromEntries(
    Object.entries(filter).filter(([, value]) =>
      Array.isArray(value)
        ? value.length > 0
        : value !== undefined && value !== '' && value !== false,
    ),
  );
}

function toggled(list: MediaType[] | undefined, type: MediaType): MediaType[] {
  const current = list ?? [];
  return current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
}

/**
 * Library search and filters (SPEC 8.1 #3), shared by the grid and the map so
 * both show the same selection. Empty values are dropped so an unfiltered
 * library always has the same query key.
 */
export const useFilterStore = create<FilterState>((set) => ({
  filter: {},
  setText: (text) => set((s) => ({ filter: withoutEmpty({ ...s.filter, text }) })),
  toggleMediaType: (type) =>
    set((s) => ({
      filter: withoutEmpty({ ...s.filter, mediaTypes: toggled(s.filter.mediaTypes, type) }),
    })),
  toggleFlag: (flag) =>
    set((s) => ({ filter: withoutEmpty({ ...s.filter, [flag]: !s.filter[flag] }) })),
  setList: (key, ids) => set((s) => ({ filter: withoutEmpty({ ...s.filter, [key]: ids }) })),
  clear: () => set({ filter: {} }),
}));

/**
 * Whether any filter is active.
 *
 * @param filter - The filter.
 * @returns True when something narrows the library.
 */
export const isFiltered = (filter: LibraryFilter): boolean => Object.keys(filter).length > 0;

/**
 * The current filter, debounced so typing in the search box does not query
 * the library on every key press.
 *
 * @returns The settled filter.
 */
export function useSettledFilter(): LibraryFilter {
  return useDebounced(
    useFilterStore((s) => s.filter),
    250,
  );
}
