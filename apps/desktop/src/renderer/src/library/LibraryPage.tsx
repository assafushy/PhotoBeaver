import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { LibraryGrid } from './LibraryGrid';
import { useLibrary } from './use-library';

function EmptyLibrary() {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="library-empty"
    >
      <h2 className="text-xl font-semibold">{t('library.emptyTitle')}</h2>
      <p className="text-neutral-500 dark:text-neutral-400">{t('library.emptyBody')}</p>
      <Link
        to="/sources"
        className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
      >
        {t('library.addSource')}
      </Link>
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

function LibraryHeader({ total, loadingMore }: { total: number; loadingMore: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <h1 className="text-lg font-semibold">{t('nav.library')}</h1>
      <span className="text-sm text-neutral-500" data-testid="library-count">
        {t('library.count', { count: total })}
        {loadingMore ? ` · ${t('library.loadingMore')}` : ''}
      </span>
    </header>
  );
}

export function LibraryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { items, total, isPending, isError, isLoadingMore } = useLibrary();
  const open = useCallback(
    (index: number) => navigate(`/library/asset/${items[index]!.id}`),
    [items, navigate],
  );
  if (isPending) return <StatusMessage text={t('library.loading')} />;
  if (isError) return <StatusMessage text={t('library.error')} />;
  if (total === 0) return <EmptyLibrary />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LibraryHeader total={total} loadingMore={isLoadingMore} />
      <LibraryGrid items={items} onOpen={open} />
      <Outlet context={{ items }} />
    </div>
  );
}
