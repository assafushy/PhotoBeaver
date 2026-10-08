import type { AssetDetail } from '@photobeaver/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAlbumActions, useAlbums } from '../albums/use-albums';
import { useFilterStore } from '../search/filter-store';
import { useCan } from '../session/use-session';

const NEW_ALBUM = '__new__';
const field =
  'w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100';

interface AssetProps {
  asset: AssetDetail;
}

function NewAlbumForm({ onCreate, onCancel }: { onCreate(name: string): void; onCancel(): void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onCreate(name.trim());
  };
  return (
    <form onSubmit={submit}>
      <input
        autoFocus
        aria-label={t('albums.nameLabel')}
        placeholder={t('albums.nameLabel')}
        className={field}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => (e.key === 'Escape' ? onCancel() : undefined)}
        data-testid="new-album-name"
      />
    </form>
  );
}

function AlbumSelect({ onPick }: { onPick(value: string): void }) {
  const { t } = useTranslation();
  const { data } = useAlbums();
  const userAlbums = (data ?? []).filter((album) => album.sourceId === null);
  return (
    <select
      aria-label={t('edits.addToAlbum')}
      className={field}
      value=""
      onChange={(e) => onPick(e.target.value)}
      data-testid="add-to-album"
    >
      <option value="">{t('edits.addToAlbum')}</option>
      {userAlbums.map((album) => (
        <option key={album.id} value={album.id}>
          {album.name}
        </option>
      ))}
      <option value={NEW_ALBUM}>{t('edits.newAlbum')}</option>
    </select>
  );
}

/** Adds the asset to a user album, or to a new one ("New album..."). */
export function AddToAlbum({ asset }: AssetProps) {
  const { create, addAssets } = useAlbumActions();
  const [creating, setCreating] = useState(false);
  const add = (id: string) => addAssets.mutate({ id, assetIds: [asset.id] });
  const createAndAdd = async (name: string) => {
    setCreating(false);
    add((await create.mutateAsync(name)).id);
  };
  if (!useCan('albums.edit')) return null;
  if (creating)
    return (
      <NewAlbumForm onCreate={(n) => void createAndAdd(n)} onCancel={() => setCreating(false)} />
    );
  const pick = (value: string) => (value === NEW_ALBUM ? setCreating(true) : value && add(value));
  return <AlbumSelect onPick={pick} />;
}

/**
 * "Remove from album" while the library is filtered to exactly one user album
 * that contains the asset.
 */
export function RemoveFromAlbumButton({ asset }: AssetProps) {
  const { t } = useTranslation();
  const albumIds = useFilterStore((s) => s.filter.albumIds);
  const { removeAssets } = useAlbumActions();
  const album = albumIds?.length === 1 ? asset.albums.find((a) => a.id === albumIds[0]) : undefined;
  if (!useCan('albums.edit') || !album?.user) return null;
  return (
    <button
      type="button"
      className="text-xs text-amber-400 hover:underline disabled:opacity-50"
      disabled={removeAssets.isPending}
      onClick={() => removeAssets.mutate({ id: album.id, assetIds: [asset.id] })}
      data-testid="remove-from-album"
    >
      {t('edits.removeFromAlbum', { name: album.name })}
    </button>
  );
}
