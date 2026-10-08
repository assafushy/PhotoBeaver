import type { LibraryFacets } from '@photobeaver/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlbums } from '../albums/use-albums';
import { usePbEvent } from '../lib/use-pb-event';
import { isFiltered, useFilterStore } from './filter-store';

const chipBase =
  'rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-amber-500';
const chipOn =
  'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';
const chipOff =
  'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800';
const selectStyle =
  'rounded-full border border-neutral-300 bg-transparent px-3 py-1 text-xs dark:border-neutral-700';

function Chip({ on, onClick, children }: { on: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`${chipBase} ${on ? chipOn : chipOff}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SearchBox() {
  const { t } = useTranslation();
  const setText = useFilterStore((s) => s.setText);
  const text = useFilterStore((s) => s.filter.text ?? '');
  return (
    <input
      type="search"
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={t('search.placeholder')}
      aria-label={t('search.label')}
      className="w-64 rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700"
      data-testid="search-box"
    />
  );
}

function useFacets() {
  const client = useQueryClient();
  usePbEvent('library.changed', () => void client.invalidateQueries({ queryKey: ['facets'] }));
  return useQuery({ queryKey: ['facets'], queryFn: () => window.pb.library.facets() });
}

type Facet = LibraryFacets['places'][number];

interface FacetSelectProps {
  label: string;
  facets: Facet[];
  selected: string[] | undefined;
  onSelect(ids: string[]): void;
  testId: string;
}

function FacetSelect({ label, facets, selected, onSelect, testId }: FacetSelectProps) {
  if (facets.length === 0) return null;
  return (
    <select
      aria-label={label}
      className={selectStyle}
      value={selected?.[0] ?? ''}
      onChange={(e) => onSelect(e.target.value ? [e.target.value] : [])}
      data-testid={testId}
    >
      <option value="">{label}</option>
      {facets.map((facet) => (
        <option key={facet.id} value={facet.id}>{`${facet.name} (${facet.count})`}</option>
      ))}
    </select>
  );
}

function useChips() {
  const { filter, toggleMediaType, toggleFlag } = useFilterStore();
  const hasType = (type: 'image' | 'video') => filter.mediaTypes?.includes(type) ?? false;
  return [
    { key: 'photos', on: hasType('image'), toggle: () => toggleMediaType('image') },
    { key: 'videos', on: hasType('video'), toggle: () => toggleMediaType('video') },
    { key: 'favorites', on: !!filter.favoritesOnly, toggle: () => toggleFlag('favoritesOnly') },
    { key: 'multiSource', on: !!filter.multiSource, toggle: () => toggleFlag('multiSource') },
  ];
}

function TypeChips() {
  const { t } = useTranslation();
  return (
    <>
      {useChips().map((chip) => (
        <Chip key={chip.key} on={chip.on} onClick={chip.toggle}>
          {t(`search.${chip.key}`)}
        </Chip>
      ))}
    </>
  );
}

function replaceGroup(current: string[] | undefined, group: Facet[], ids: string[]): string[] {
  const inGroup = new Set(group.map((facet) => facet.id));
  return [...(current ?? []).filter((id) => !inGroup.has(id)), ...ids];
}

function selectedIn(current: string[] | undefined, group: Facet[]): string[] {
  return (current ?? []).filter((id) => group.some((facet) => facet.id === id));
}

function TagSelect({ kind, facets }: { kind: 'place' | 'tag'; facets: Facet[] }) {
  const { t } = useTranslation();
  const { filter, setList } = useFilterStore();
  return (
    <FacetSelect
      label={t(`search.${kind}`)}
      facets={facets}
      selected={selectedIn(filter.tagIds, facets)}
      onSelect={(ids) => setList('tagIds', replaceGroup(filter.tagIds, facets, ids))}
      testId={`filter-${kind}`}
    />
  );
}

interface ListSelectProps {
  field: 'personIds' | 'sourceIds';
  kind: 'person' | 'source';
  facets: Facet[];
}

function ListSelect({ field, kind, facets }: ListSelectProps) {
  const { t } = useTranslation();
  const { filter, setList } = useFilterStore();
  return (
    <FacetSelect
      label={t(`search.${kind}`)}
      facets={facets}
      selected={filter[field]}
      onSelect={(ids) => setList(field, ids)}
      testId={`filter-${kind}`}
    />
  );
}

function AlbumFilter() {
  const { t } = useTranslation();
  const { data } = useAlbums();
  const { filter, setList } = useFilterStore();
  const facets = (data ?? []).map(({ id, name, count }) => ({ id, name, count }));
  return (
    <FacetSelect
      label={t('albums.any')}
      facets={facets}
      selected={filter.albumIds}
      onSelect={(ids) => setList('albumIds', ids)}
      testId="filter-album"
    />
  );
}

function FacetSelects() {
  const { data } = useFacets();
  if (!data) return null;
  return (
    <>
      <TagSelect kind="place" facets={data.places} />
      <TagSelect kind="tag" facets={data.tags} />
      <ListSelect field="personIds" kind="person" facets={data.people} />
      <ListSelect field="sourceIds" kind="source" facets={data.sources} />
      <AlbumFilter />
    </>
  );
}

/**
 * Search box and filter chips above the grid and the map (SPEC 8.1 #3).
 */
export function FilterBar() {
  const { t } = useTranslation();
  const { filter, clear } = useFilterStore();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
      <SearchBox />
      <TypeChips />
      <FacetSelects />
      {isFiltered(filter) && (
        <button type="button" className="text-xs text-amber-600 hover:underline" onClick={clear}>
          {t('search.clear')}
        </button>
      )}
    </div>
  );
}
