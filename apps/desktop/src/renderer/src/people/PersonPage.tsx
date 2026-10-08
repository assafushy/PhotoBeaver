import type { PersonSummary } from '@photobeaver/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useFilterStore } from '../search/filter-store';
import { useCan } from '../session/use-session';
import { FaceActions } from './FaceActions';
import { FaceStrip } from './FaceStrip';
import { PersonName } from './PersonName';
import { usePeople, usePeopleActions, usePersonFaces } from './use-people';

function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return { selected, toggle, clear: () => setSelected(new Set()) };
}

function useMergeInto(personId: string) {
  const navigate = useNavigate();
  const { merge } = usePeopleActions();
  return (id: string) =>
    merge.mutate({ fromId: personId, intoId: id }, { onSuccess: () => navigate(`/people/${id}`) });
}

function MergeInto({ person, others }: { person: PersonSummary; others: PersonSummary[] }) {
  const { t } = useTranslation();
  const into = useMergeInto(person.id);
  return (
    <select
      aria-label={t('people.mergeInto')}
      className="rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
      value=""
      onChange={(e) => e.target.value && into(e.target.value)}
      data-testid="merge-into"
    >
      <option value="">{t('people.mergeInto')}</option>
      {others.map((p) => (
        <option
          key={p.id}
          value={p.id}
        >{`${p.name ?? t('people.unnamed')} (${p.faceCount})`}</option>
      ))}
    </select>
  );
}

function ShowPhotosButton({ personId }: { personId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showPhotos = () => (
    useFilterStore.getState().setList('personIds', [personId]),
    navigate('/library')
  );
  return (
    <button
      type="button"
      className="text-sm text-amber-600 hover:underline"
      onClick={showPhotos}
      data-testid="show-photos"
    >
      {t('people.showPhotos')}
    </button>
  );
}

function PersonHeader({ person, others }: { person: PersonSummary; others: PersonSummary[] }) {
  const { t } = useTranslation();
  const canEdit = useCan('people.edit');
  return (
    <header className="flex flex-wrap items-center gap-3">
      <Link to="/people" className="text-sm text-amber-600 hover:underline">
        {t('nav.people')}
      </Link>
      <PersonName id={person.id} name={person.name} className="text-lg font-semibold" />
      <span className="text-sm text-neutral-500">
        {t('people.photos', { count: person.assetCount })}
      </span>
      <ShowPhotosButton personId={person.id} />
      {canEdit && <MergeInto person={person} others={others} />}
    </header>
  );
}

function usePersonData(personId: string) {
  const { data: everyone } = usePeople();
  const { data: faces } = usePersonFaces(personId);
  const person = everyone?.find((p) => p.id === personId);
  const others = (everyone ?? []).filter((p) => p.id !== personId);
  return { person, others, faces: faces?.items ?? [] };
}

type PersonData = ReturnType<typeof usePersonData>;

function PersonFaces({
  personId,
  others,
  faces,
}: Omit<PersonData, 'person'> & { personId: string }) {
  const selection = useSelection();
  const canEdit = useCan('people.edit');
  return (
    <>
      {canEdit && (
        <FaceActions
          personId={personId}
          selected={[...selection.selected]}
          others={others}
          onDone={selection.clear}
        />
      )}
      <FaceStrip
        faces={faces}
        selected={selection.selected}
        onToggle={canEdit ? selection.toggle : () => undefined}
      />
    </>
  );
}

/**
 * One person (SPEC 8.1 #5): rename, merge into someone else, and split by
 * selecting faces that belong to another person. Read-only without people.edit.
 */
export function PersonPage() {
  const { personId = '' } = useParams();
  const { person, others, faces } = usePersonData(personId);
  if (!person) return null;
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-6" data-testid="person-page">
      <PersonHeader person={person} others={others} />
      <PersonFaces personId={personId} others={others} faces={faces} />
    </div>
  );
}
