import { useTranslation } from 'react-i18next';
import { useLibraryFirstPage } from '../lib/queries';

function EmptyLibrary() {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      data-testid="library-empty"
    >
      <h2 className="text-xl font-semibold">{t('library.emptyTitle')}</h2>
      <p className="text-neutral-500 dark:text-neutral-400">{t('library.emptyBody')}</p>
    </div>
  );
}

function StatusMessage({ text }: { text: string }) {
  return (
    <p role="status" className="p-8 text-neutral-500">
      {text}
    </p>
  );
}

export function LibraryPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useLibraryFirstPage();
  if (isPending) return <StatusMessage text={t('library.loading')} />;
  if (isError) return <StatusMessage text={t('library.error')} />;
  if (data.total === 0) return <EmptyLibrary />;
  return <StatusMessage text={t('library.count', { count: data.total })} />;
}
