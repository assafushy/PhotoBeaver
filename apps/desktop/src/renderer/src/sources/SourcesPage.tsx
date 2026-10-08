import type { PbEvents, SourceSummary } from '@photobeaver/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonStyles } from '../components/Modal';
import { useCan } from '../session/use-session';
import { AddSourceDialog } from './AddSourceDialog';
import { SourceCard } from './SourceCard';
import { useSources } from './use-sources';

interface SourceListProps {
  sources: SourceSummary[];
  progress: Record<string, PbEvents['sync.progress']>;
}

function SourceList({ sources, progress }: SourceListProps) {
  const { t } = useTranslation();
  if (sources.length === 0) return <p className="text-neutral-500">{t('sources.empty')}</p>;
  return (
    <ul className="space-y-3">
      {sources.map((source) => (
        <SourceCard key={source.id} source={source} progress={progress[source.id]} />
      ))}
    </ul>
  );
}

/**
 * Sources screen (SPEC 8.1): connected sources with status and actions, and "Add source".
 */
export function SourcesPage() {
  const { t } = useTranslation();
  const { data = [], progress } = useSources();
  const [adding, setAdding] = useState(false);
  const canManage = useCan('sources.manage');
  return (
    <section className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('nav.sources')}</h1>
        {canManage && (
          <button type="button" className={buttonStyles.primary} onClick={() => setAdding(true)}>
            {t('sources.addSource')}
          </button>
        )}
      </header>
      <SourceList sources={data} progress={progress} />
      <AddSourceDialog open={adding} onOpenChange={setAdding} />
    </section>
  );
}
