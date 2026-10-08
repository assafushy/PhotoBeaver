import type { AssetDetail } from '@photobeaver/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryMutation } from '../albums/use-albums';
import { formatFull } from '../library/dates';
import { useCan } from '../session/use-session';

export { AddToAlbum, RemoveFromAlbumButton } from './AlbumControls';

const linkButton = 'text-xs text-amber-400 hover:underline disabled:opacity-50';
const field =
  'w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100';
const chip = 'flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs';

interface AssetProps {
  asset: AssetDetail;
}

const toInputValue = (ms: number | null): string =>
  ms === null ? '' : new Date(ms).toISOString().slice(0, 16);

const fromInputValue = (value: string): number | null => {
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? null : ms;
};

/** Star toggle for the asset's favorite flag (Editors and Admins). */
export function FavoriteButton({ asset }: AssetProps) {
  const { t } = useTranslation();
  const set = useLibraryMutation((favorite: boolean) =>
    window.pb.edits.setFavorite([asset.id], favorite),
  );
  if (!useCan('assets.edit')) return null;
  const label = asset.favorite ? t('edits.unfavorite') : t('edits.favorite');
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={asset.favorite}
      title={label}
      className={`text-xl ${asset.favorite ? 'text-amber-400' : 'text-neutral-500'} hover:text-amber-300`}
      disabled={set.isPending}
      onClick={() => set.mutate(!asset.favorite)}
      data-testid="favorite-toggle"
    >
      {asset.favorite ? '★' : '☆'}
    </button>
  );
}

/** Hides the asset from the library, or shows it again. */
export function HideButton({ asset }: AssetProps) {
  const { t } = useTranslation();
  const set = useLibraryMutation((hidden: boolean) =>
    window.pb.edits.setHidden([asset.id], hidden),
  );
  if (!useCan('assets.edit')) return null;
  return (
    <button
      type="button"
      className={linkButton}
      disabled={set.isPending}
      onClick={() => set.mutate(!asset.hidden)}
      data-testid="hide-toggle"
    >
      {asset.hidden ? t('edits.unhide') : t('edits.hide')}
    </button>
  );
}

function TagChip({ name, onRemove }: { name: string; onRemove(): void }) {
  const { t } = useTranslation();
  return (
    <li className={chip} data-testid="user-tag">
      {name}
      <button
        type="button"
        aria-label={t('edits.removeTag', { name })}
        className="text-neutral-400 hover:text-neutral-100"
        onClick={onRemove}
      >
        {'×'}
      </button>
    </li>
  );
}

function TagInput({ onAdd }: { onAdd(name: string): void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) onAdd(draft.trim());
    setDraft('');
  };
  return (
    <form onSubmit={submit} className="mt-1">
      <input
        aria-label={t('edits.addTag')}
        placeholder={t('edits.addTag')}
        className={field}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        data-testid="tag-input"
      />
    </form>
  );
}

/** The asset's user tags as removable chips, with a field to add one. */
export function TagEditor({ asset }: AssetProps) {
  const { t } = useTranslation();
  const add = useLibraryMutation((name: string) => window.pb.edits.addTag([asset.id], name));
  const remove = useLibraryMutation((name: string) => window.pb.edits.removeTag([asset.id], name));
  if (!useCan('assets.edit')) return null;
  const userTags = asset.tags.filter((tag) => tag.kind === 'user');
  return (
    <div className="py-1.5">
      <div className="text-xs text-neutral-400">{t('edits.userTags')}</div>
      <ul className="mt-1 flex flex-wrap gap-1">
        {userTags.map((tag) => (
          <TagChip key={tag.name} name={tag.name} onRemove={() => remove.mutate(tag.name)} />
        ))}
      </ul>
      <TagInput onAdd={(name) => add.mutate(name)} />
    </div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange(value: string): void }) {
  const { t } = useTranslation();
  return (
    <input
      type="datetime-local"
      aria-label={t('edits.dateLabel')}
      className={field}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="date-input"
    />
  );
}

function DateForm({ asset, onDone }: AssetProps & { onDone(): void }) {
  const [value, setValue] = useState(toInputValue(asset.capturedAt));
  const save = useLibraryMutation((ms: number | null) => window.pb.edits.setDate(asset.id, ms));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ms = fromInputValue(value);
    if (ms !== null) save.mutate(ms, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="mt-1 space-y-1">
      <DateInput value={value} onChange={setValue} />
      <FormButtons onCancel={onDone} disabled={save.isPending} />
    </form>
  );
}

function FormButtons({ onCancel, disabled }: { onCancel(): void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3">
      <button type="submit" className={linkButton} disabled={disabled}>
        {t('common.save')}
      </button>
      <button type="button" className={linkButton} onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

/** Edits the capture date and time; "Reset" drops the user's date. */
export function DateEditor({ asset }: AssetProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  if (!useCan('assets.edit')) return null;
  if (editing) return <DateForm asset={asset} onDone={() => setEditing(false)} />;
  return (
    <div className="flex gap-3">
      <button
        type="button"
        className={linkButton}
        title={asset.capturedAt === null ? undefined : formatFull(asset.capturedAt)}
        onClick={() => setEditing(true)}
        data-testid="edit-date"
      >
        {t('edits.editDate')}
      </button>
      {asset.capturedAtSource === 'user' && <ResetDateButton asset={asset} />}
    </div>
  );
}

function ResetDateButton({ asset }: AssetProps) {
  const { t } = useTranslation();
  const reset = useLibraryMutation(() => window.pb.edits.setDate(asset.id, null));
  return (
    <button type="button" className={linkButton} onClick={() => reset.mutate(undefined)}>
      {t('edits.resetDate')}
    </button>
  );
}

function parseCoordinate(value: string, limit: number): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function CoordinateInput(props: { label: string; value: string; onChange(v: string): void }) {
  return (
    <input
      inputMode="decimal"
      aria-label={props.label}
      placeholder={props.label}
      className={field}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

function LocationForm({ asset, onDone }: AssetProps & { onDone(): void }) {
  const { t } = useTranslation();
  const [lat, setLat] = useState(asset.lat?.toString() ?? '');
  const [lon, setLon] = useState(asset.lon?.toString() ?? '');
  const save = useLibraryMutation((loc: { lat: number; lon: number }) =>
    window.pb.edits.setLocation(asset.id, loc),
  );
  const parsed = { lat: parseCoordinate(lat, 90), lon: parseCoordinate(lon, 180) };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed.lat !== null && parsed.lon !== null)
      save.mutate({ lat: parsed.lat, lon: parsed.lon }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="mt-1 space-y-1" data-testid="location-form">
      <CoordinateInput label={t('edits.latitude')} value={lat} onChange={setLat} />
      <CoordinateInput label={t('edits.longitude')} value={lon} onChange={setLon} />
      <FormButtons onCancel={onDone} disabled={save.isPending} />
    </form>
  );
}

/** Edits the location as latitude and longitude; "Clear" drops the user's location. */
export function LocationEditor({ asset }: AssetProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const clear = useLibraryMutation(() => window.pb.edits.setLocation(asset.id, null));
  if (!useCan('assets.edit')) return null;
  if (editing) return <LocationForm asset={asset} onDone={() => setEditing(false)} />;
  return (
    <div className="flex gap-3">
      <button type="button" className={linkButton} onClick={() => setEditing(true)}>
        {t('edits.editLocation')}
      </button>
      {asset.locationSource === 'user' && (
        <button type="button" className={linkButton} onClick={() => clear.mutate(undefined)}>
          {t('edits.clearLocation')}
        </button>
      )}
    </div>
  );
}

/** "Re-run enrichment" for this asset (needs `sources.sync`). */
export function RerunButton({ asset }: AssetProps) {
  const { t } = useTranslation();
  const rerun = useLibraryMutation(() => window.pb.edits.rerun([asset.id]));
  if (!useCan('sources.sync')) return null;
  return (
    <button
      type="button"
      className={linkButton}
      disabled={rerun.isPending}
      onClick={() => rerun.mutate(undefined)}
      data-testid="rerun-enrichment"
    >
      {rerun.isSuccess ? t('edits.rerunQueued') : t('edits.rerun')}
    </button>
  );
}
