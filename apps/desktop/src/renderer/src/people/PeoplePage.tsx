import type { PersonSummary } from '@photobeaver/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PersonName } from './PersonName';
import { faceUrl, usePeople } from './use-people';

function PersonCover({ coverFaceId }: { coverFaceId: string | null }) {
  if (!coverFaceId)
    return <div className="h-36 w-36 rounded-full bg-neutral-200 dark:bg-neutral-800" />;
  return (
    <img
      src={faceUrl(coverFaceId)}
      alt=""
      className="h-36 w-36 rounded-full bg-neutral-200 object-cover dark:bg-neutral-800"
    />
  );
}

function PersonCard({ person }: { person: PersonSummary }) {
  const { t } = useTranslation();
  return (
    <li className="w-36" data-testid="person-card" data-person-id={person.id}>
      <Link to={`/people/${person.id}`} className="block">
        <PersonCover coverFaceId={person.coverFaceId} />
      </Link>
      <div className="mt-2 text-sm font-medium">
        <PersonName id={person.id} name={person.name} />
      </div>
      <div className="text-xs text-neutral-500">
        {t('people.photos', { count: person.assetCount })}
      </div>
    </li>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-neutral-500" data-testid="people-empty">
      {t('people.empty')}
    </p>
  );
}

/**
 * People screen (SPEC 8.1 #5): everyone the faces plugin found, named people
 * first, then unnamed groups by size. Click a name to edit it.
 */
export function PeoplePage() {
  const { t } = useTranslation();
  const { data } = usePeople();
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-6">
      <header>
        <h1 className="text-lg font-semibold">{t('nav.people')}</h1>
        <p className="text-sm text-neutral-500">{t('people.intro')}</p>
      </header>
      {data && data.length === 0 && <Empty />}
      <ul className="flex flex-wrap gap-6">
        {(data ?? []).map((person) => (
          <PersonCard key={person.id} person={person} />
        ))}
      </ul>
    </div>
  );
}
