import type { PersonSummary } from '@photobeaver/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonStyles } from '../components/Modal';
import { usePeopleActions } from './use-people';

interface FaceActionsProps {
  personId: string;
  selected: string[];
  others: PersonSummary[];
  onDone(): void;
}

const label = (p: PersonSummary, unnamed: string) => `${p.name ?? unnamed} (${p.faceCount})`;

function MoveToSelect({ others, onPick }: { others: PersonSummary[]; onPick(id: string): void }) {
  const { t } = useTranslation();
  return (
    <select
      aria-label={t('people.moveTo')}
      className="rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      <option value="">{t('people.moveTo')}</option>
      {others.map((p) => (
        <option key={p.id} value={p.id}>
          {label(p, t('people.unnamed'))}
        </option>
      ))}
    </select>
  );
}

function ActionButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className={buttonStyles.secondary} onClick={onClick}>
      {children}
    </button>
  );
}

function useFaceHandlers({ personId, selected, onDone }: Omit<FaceActionsProps, 'others'>) {
  const { move, reject, cover } = usePeopleActions();
  const after = { onSuccess: onDone };
  return {
    toNew: () => move.mutate({ faceIds: selected, target: { newPerson: true } }, after),
    toPerson: (id: string) => move.mutate({ faceIds: selected, target: { personId: id } }, after),
    reject: () => (selected.forEach((id) => reject.mutate(id)), onDone()),
    cover: () => cover.mutate({ personId, faceId: selected[0]! }, after),
  };
}

/**
 * What to do with the selected faces: split them off into a new person, move
 * them to someone else, mark them as not this person, or use one as the cover.
 */
export function FaceActions({ personId, selected, others, onDone }: FaceActionsProps) {
  const { t } = useTranslation();
  const handlers = useFaceHandlers({ personId, selected, onDone });
  if (selected.length === 0)
    return <p className="text-xs text-neutral-500">{t('people.selectHint')}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton onClick={handlers.toNew}>{t('people.moveToNew')}</ActionButton>
      <MoveToSelect others={others} onPick={handlers.toPerson} />
      <ActionButton onClick={handlers.reject}>{t('people.notThisPerson')}</ActionButton>
      {selected.length === 1 && (
        <ActionButton onClick={handlers.cover}>{t('people.makeCover')}</ActionButton>
      )}
    </div>
  );
}
