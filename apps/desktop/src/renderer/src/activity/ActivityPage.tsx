import type { AuditPage } from '@photobeaver/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { buttonStyles } from '../components/Modal';
import { formatInstant } from '../library/dates';

type AuditEntry = AuditPage['items'][number];

const PAGE_SIZE = 100;

function useAuditLog() {
  return useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) => window.pb.audit.list(pageParam, PAGE_SIZE),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

function detailText(details: AuditEntry['details'], key: string): string | null {
  const value = details?.[key];
  return typeof value === 'string' && value ? value : null;
}

function targetOf(entry: AuditEntry): string {
  const named = detailText(entry.details, 'displayName') ?? detailText(entry.details, 'name');
  return named ?? entry.targetId ?? '';
}

function useActionLabel(): (action: string) => string {
  const { t } = useTranslation();
  return (action) => t(`activity.action.${action.replace(/\./g, '_')}`, { defaultValue: action });
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  const label = useActionLabel();
  return (
    <li
      className="grid grid-cols-[11rem_9rem_1fr] gap-3 border-t border-neutral-200 py-2 text-sm dark:border-neutral-800"
      data-testid="activity-row"
      data-action={entry.action}
    >
      <span className="text-neutral-500">{formatInstant(entry.createdAt)}</span>
      <span className="truncate font-medium">{entry.userName ?? t('activity.system')}</span>
      <span className="min-w-0 truncate">
        {label(entry.action)}
        {targetOf(entry) && <span className="text-neutral-500">{` · ${targetOf(entry)}`}</span>}
      </span>
    </li>
  );
}

function LoadMore({ log }: { log: ReturnType<typeof useAuditLog> }) {
  const { t } = useTranslation();
  if (!log.hasNextPage) return null;
  return (
    <button
      type="button"
      className={buttonStyles.secondary}
      disabled={log.isFetchingNextPage}
      onClick={() => void log.fetchNextPage()}
      data-testid="activity-more"
    >
      {t('activity.loadMore')}
    </button>
  );
}

/**
 * Activity screen (Admin): the audit log of changes to the library, users and
 * settings, newest first (SPEC 3.3).
 */
export function ActivityPage() {
  const { t } = useTranslation();
  const log = useAuditLog();
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="mx-auto w-full max-w-4xl space-y-4 p-6" data-testid="activity-page">
      <h1 className="text-2xl font-semibold">{t('nav.activity')}</h1>
      {log.data && entries.length === 0 && (
        <p className="text-sm text-neutral-500">{t('activity.empty')}</p>
      )}
      <ul>
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
      <LoadMore log={log} />
    </section>
  );
}
