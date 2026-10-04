import { useTranslation } from 'react-i18next';
import { DuplicateGroupCard } from './DuplicateGroupCard';
import { RecentMerges } from './RecentMerges';
import { useDuplicates } from './use-duplicates';

function Groups() {
  const { t } = useTranslation();
  const { groups } = useDuplicates();
  if (!groups.data) return null;
  if (groups.data.length === 0)
    return (
      <p className="text-sm text-neutral-500" data-testid="duplicates-empty">
        {t('duplicates.empty')}
      </p>
    );
  return (
    <ul className="space-y-4">
      {groups.data.map((group) => (
        <DuplicateGroupCard key={group.id} group={group} />
      ))}
    </ul>
  );
}

/**
 * Duplicates screen (SPEC 8.1 #7): suggestions to review, and recent merges
 * that can be undone.
 */
export function DuplicatesPage() {
  const { t } = useTranslation();
  const { merges } = useDuplicates();
  return (
    <div className="flex-1 space-y-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-lg font-semibold">{t('nav.duplicates')}</h1>
        <p className="text-sm text-neutral-500">{t('duplicates.intro')}</p>
      </header>
      <Groups />
      <RecentMerges merges={merges.data ?? []} />
    </div>
  );
}
