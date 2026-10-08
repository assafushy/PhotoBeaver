import type { AlbumSummary } from '@photobeaver/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useFilterStore } from '../search/filter-store';
import { useCan } from '../session/use-session';
import { DeleteAlbumDialog, NameAlbumDialog } from './AlbumDialogs';
import { albumCoverUrl, useAlbumActions, useAlbums } from './use-albums';

const coverBox = 'h-40 w-40 rounded-lg bg-neutral-200 object-cover dark:bg-neutral-800';
const linkButton = 'text-xs text-amber-600 hover:underline';

type Dialog = { kind: 'rename' | 'delete'; album: AlbumSummary } | { kind: 'create' } | null;

function useOpenAlbum(): (albumId: string) => void {
  const navigate = useNavigate();
  const { clear, setList } = useFilterStore();
  return (albumId) => {
    clear();
    setList('albumIds', [albumId]);
    navigate('/library');
  };
}

function AlbumCover({ album }: { album: AlbumSummary }) {
  const { t } = useTranslation();
  const open = useOpenAlbum();
  return (
    <button
      type="button"
      aria-label={t('albums.open', { name: album.name })}
      onClick={() => open(album.id)}
      className="block"
    >
      {album.coverAssetId ? (
        <img src={albumCoverUrl(album.coverAssetId)} alt="" className={coverBox} />
      ) : (
        <div className={coverBox} />
      )}
    </button>
  );
}

interface CardProps {
  album: AlbumSummary;
  onDialog(dialog: Dialog): void;
}

function CardActions({ album, onDialog }: CardProps) {
  const { t } = useTranslation();
  if (!useCan('albums.edit') || album.sourceId !== null) return null;
  return (
    <div className="flex gap-3">
      <button
        type="button"
        className={linkButton}
        onClick={() => onDialog({ kind: 'rename', album })}
      >
        {t('albums.rename')}
      </button>
      <button
        type="button"
        className={linkButton}
        onClick={() => onDialog({ kind: 'delete', album })}
      >
        {t('albums.delete')}
      </button>
    </div>
  );
}

function AlbumCard({ album, onDialog }: CardProps) {
  const { t } = useTranslation();
  return (
    <li className="w-40" data-testid="album-card" data-album-id={album.id}>
      <AlbumCover album={album} />
      <div className="mt-2 truncate text-sm font-medium">{album.name}</div>
      <div className="text-xs text-neutral-500">
        {t('albums.photos', { count: album.count })}
        {album.sourceName && ` · ${t('albums.fromSource', { source: album.sourceName })}`}
      </div>
      <CardActions album={album} onDialog={onDialog} />
    </li>
  );
}

function PageHeader({ onCreate }: { onCreate(): void }) {
  const { t } = useTranslation();
  const canEdit = useCan('albums.edit');
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t('nav.albums')}</h1>
        <p className="text-sm text-neutral-500">{t('albums.intro')}</p>
      </div>
      {canEdit && (
        <button
          type="button"
          className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
          onClick={onCreate}
          data-testid="new-album"
        >
          {t('albums.new')}
        </button>
      )}
    </header>
  );
}

function AlbumDialogs({ dialog, onClose }: { dialog: Dialog; onClose(): void }) {
  const { t } = useTranslation();
  const { create, rename } = useAlbumActions();
  if (dialog?.kind === 'delete')
    return <DeleteAlbumDialog album={dialog.album} onClose={onClose} />;
  if (dialog?.kind === 'rename') {
    const { id, name } = dialog.album;
    const save = (next: string) => rename.mutate({ id, name: next }, { onSuccess: onClose });
    return (
      <NameAlbumDialog title={t('albums.rename')} initial={name} onSave={save} onClose={onClose} />
    );
  }
  if (dialog?.kind === 'create') {
    const save = (name: string) => create.mutate(name, { onSuccess: onClose });
    return <NameAlbumDialog title={t('albums.new')} initial="" onSave={save} onClose={onClose} />;
  }
  return null;
}

/**
 * Albums screen (SPEC 3.3, 8.1): user albums and albums from sources, with a
 * cover and the number of photos. Opening an album filters the library to it.
 * Editors can create, rename and delete user albums; source albums are read-only.
 */
export function AlbumsPage() {
  const { t } = useTranslation();
  const { data } = useAlbums();
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-6">
      <PageHeader onCreate={() => setDialog({ kind: 'create' })} />
      {data && data.length === 0 && (
        <p className="text-sm text-neutral-500" data-testid="albums-empty">
          {t('albums.empty')}
        </p>
      )}
      <ul className="flex flex-wrap gap-6">
        {(data ?? []).map((album) => (
          <AlbumCard key={album.id} album={album} onDialog={setDialog} />
        ))}
      </ul>
      <AlbumDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
