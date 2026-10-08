import type { AlbumSummary } from '@photobeaver/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { buttonStyles, Modal } from '../components/Modal';
import { useAlbumActions } from './use-albums';

interface NameAlbumDialogProps {
  title: string;
  initial: string;
  onSave(name: string): void;
  onClose(): void;
}

function DialogButtons({ label, onClose }: { label: string; onClose(): void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" className={buttonStyles.secondary} onClick={onClose}>
        {t('common.cancel')}
      </button>
      <button type="submit" className={buttonStyles.primary} data-testid="album-dialog-submit">
        {label}
      </button>
    </div>
  );
}

function NameInput({ value, onChange }: { value: string; onChange(value: string): void }) {
  const { t } = useTranslation();
  return (
    <input
      autoFocus
      aria-label={t('albums.nameLabel')}
      className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="album-name-input"
    />
  );
}

/** Asks for an album name (new album or rename). */
export function NameAlbumDialog({ title, initial, onSave, onClose }: NameAlbumDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSave(name.trim());
  };
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={title}>
      <form onSubmit={submit}>
        <NameInput value={name} onChange={setName} />
        <DialogButtons label={t('common.save')} onClose={onClose} />
      </form>
    </Modal>
  );
}

/** Confirms deleting a user album; its photos stay in the library. */
export function DeleteAlbumDialog({ album, onClose }: { album: AlbumSummary; onClose(): void }) {
  const { t } = useTranslation();
  const { remove } = useAlbumActions();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    remove.mutate(album.id, { onSuccess: onClose });
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('albums.deleteTitle')}
      description={t('albums.deleteBody', { name: album.name })}
    >
      <form onSubmit={submit}>
        {remove.error && <ErrorText>{remove.error.message}</ErrorText>}
        <DialogButtons label={t('albums.delete')} onClose={onClose} />
      </form>
    </Modal>
  );
}
