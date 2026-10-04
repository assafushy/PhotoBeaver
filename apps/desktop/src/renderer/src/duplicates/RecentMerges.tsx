import type { MergeRecord } from '@photobeaver/shared';
import { useTranslation } from 'react-i18next';
import { buttonStyles } from '../components/Modal';
import { formatFull } from '../library/dates';
import { thumbUrl } from '../library/thumb-store';
import { usePlugins } from '../plugins/use-plugins';
import { useDuplicateActions } from './use-duplicates';

function useMergedByLabel(mergedBy: string): string {
  const { t } = useTranslation();
  const { data } = usePlugins();
  if (mergedBy === 'user') return t('duplicates.mergedByYou');
  const name = data?.find((plugin) => plugin.id === mergedBy)?.name ?? mergedBy;
  return t('duplicates.mergedByPlugin', { name });
}

function MergeText({ merge }: { merge: MergeRecord }) {
  const mergedBy = useMergedByLabel(merge.mergedBy);
  return (
    <div className="min-w-0 flex-1 text-sm">
      <div>{mergedBy}</div>
      {merge.createdAt !== null && (
        <div className="text-xs text-neutral-500">{formatFull(merge.createdAt)}</div>
      )}
    </div>
  );
}

function UndoButton({ mergeId }: { mergeId: string }) {
  const { t } = useTranslation();
  const { undo } = useDuplicateActions();
  return (
    <button
      type="button"
      className={buttonStyles.secondary}
      disabled={undo.isPending}
      onClick={() => undo.mutate(mergeId)}
    >
      {t('duplicates.undo')}
    </button>
  );
}

function MergeItem({ merge }: { merge: MergeRecord }) {
  return (
    <li
      className="flex items-center gap-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
      data-testid="recent-merge"
    >
      <img
        src={thumbUrl(merge.survivingAssetId, 256)}
        alt=""
        className="h-12 w-12 rounded object-cover"
      />
      <MergeText merge={merge} />
      <UndoButton mergeId={merge.id} />
    </li>
  );
}

/**
 * Recent merges with Undo (SPEC 4.3 step 5).
 */
export function RecentMerges({ merges }: { merges: MergeRecord[] }) {
  const { t } = useTranslation();
  if (merges.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{t('duplicates.recent')}</h2>
      <ul className="space-y-2">
        {merges.map((merge) => (
          <MergeItem key={merge.id} merge={merge} />
        ))}
      </ul>
    </section>
  );
}
