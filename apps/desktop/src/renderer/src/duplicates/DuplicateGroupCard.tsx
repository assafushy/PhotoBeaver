import type { DuplicateGroup } from '@photobeaver/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonStyles } from '../components/Modal';
import { formatFull } from '../library/dates';
import { thumbUrl } from '../library/thumb-store';
import { formatBytes } from '../lib/format-bytes';
import { useCan } from '../session/use-session';
import { useDuplicateActions } from './use-duplicates';

type DuplicateAsset = DuplicateGroup['assets'][number];

function AssetFacts({ asset }: { asset: DuplicateAsset }) {
  const { t } = useTranslation();
  const facts = [
    asset.width && asset.height ? `${asset.width} x ${asset.height}` : null,
    formatBytes(asset.sizeBytes),
    asset.capturedAt === null ? t('library.undated') : formatFull(asset.capturedAt),
    asset.place,
    asset.sources.join(', '),
  ];
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-300">
      {facts.filter(Boolean).map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}

function KeepRadio(props: { groupId: string; checked: boolean; onKeep(): void }) {
  const { t } = useTranslation();
  return (
    <span className="mt-2 flex items-center gap-1 text-xs font-medium">
      <input
        type="radio"
        name={`keep-${props.groupId}`}
        checked={props.checked}
        onChange={props.onKeep}
      />
      {t('duplicates.keep')}
    </span>
  );
}

function AssetChoice({
  asset,
  groupId,
  keep,
  onKeep,
}: {
  asset: DuplicateAsset;
  groupId: string;
  keep: string;
  onKeep(id: string): void;
}) {
  const canMerge = useCan('duplicates.merge');
  return (
    <label className="w-48 cursor-pointer rounded-md border border-neutral-200 p-2 has-checked:border-amber-500 dark:border-neutral-800">
      <img
        src={thumbUrl(asset.id, 256)}
        alt=""
        className="h-40 w-full rounded bg-neutral-200 object-contain dark:bg-neutral-800"
      />
      <AssetFacts asset={asset} />
      {canMerge && (
        <KeepRadio groupId={groupId} checked={keep === asset.id} onKeep={() => onKeep(asset.id)} />
      )}
    </label>
  );
}

function GroupHeader({ group }: { group: DuplicateGroup }) {
  const { t } = useTranslation();
  const confidence = group.confidence === null ? '' : ` · ${Math.round(group.confidence * 100)}%`;
  return (
    <p className="text-sm font-medium">
      {t(`duplicates.kind.${group.kind}`)}
      <span className="text-neutral-500">{confidence}</span>
    </p>
  );
}

function ActionButton({
  style,
  disabled,
  onClick,
  children,
}: {
  style: 'primary' | 'secondary';
  disabled: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={buttonStyles[style]} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function GroupActions({ group, keep }: { group: DuplicateGroup; keep: string }) {
  const { t } = useTranslation();
  const { merge, dismiss } = useDuplicateActions();
  const busy = merge.isPending || dismiss.isPending;
  return (
    <div className="flex gap-2">
      <ActionButton
        style="primary"
        disabled={busy}
        onClick={() => merge.mutate({ id: group.id, keep })}
      >
        {t('duplicates.merge')}
      </ActionButton>
      <ActionButton style="secondary" disabled={busy} onClick={() => dismiss.mutate(group.id)}>
        {t('duplicates.notDuplicates')}
      </ActionButton>
    </div>
  );
}

/**
 * One duplicate suggestion (SPEC 8.1 #7): the assets side by side, the one to
 * keep, and merge or "not duplicates".
 */
export function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const [keep, setKeep] = useState(group.assets[0]!.id);
  const canMerge = useCan('duplicates.merge');
  return (
    <li
      className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
      data-testid="duplicate-group"
    >
      <GroupHeader group={group} />
      <div className="flex flex-wrap gap-3">
        {group.assets.map((asset) => (
          <AssetChoice key={asset.id} {...{ asset, keep }} groupId={group.id} onKeep={setKeep} />
        ))}
      </div>
      {canMerge && <GroupActions group={group} keep={keep} />}
    </li>
  );
}
