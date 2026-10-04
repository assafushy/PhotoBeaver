import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonStyles } from '../components/Modal';
import { DeveloperTab } from './DeveloperTab';
import { InstallFromFile } from './InstallFromFile';
import { PluginCard } from './PluginCard';
import { usePlugins, useRefreshPlugins } from './use-plugins';

const TABS = ['installed', 'store', 'developer'] as const;
type Tab = (typeof TABS)[number];

function TabButton({
  name,
  selected,
  onSelect,
}: {
  name: Tab;
  selected: boolean;
  onSelect(): void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${name}`}
      aria-selected={selected}
      aria-controls={`panel-${name}`}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${selected ? 'border-amber-500 font-medium' : 'border-transparent text-neutral-500'}`}
      onClick={onSelect}
    >
      {t(`plugins.tab.${name}`)}
    </button>
  );
}

function TabList({ tab, onChange }: { tab: Tab; onChange(tab: Tab): void }) {
  const { t } = useTranslation();
  return (
    <div
      role="tablist"
      aria-label={t('nav.plugins')}
      className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800"
    >
      {TABS.map((name) => (
        <TabButton key={name} name={name} selected={tab === name} onSelect={() => onChange(name)} />
      ))}
    </div>
  );
}

function RestoreDefaultsButton() {
  const { t } = useTranslation();
  const refresh = useRefreshPlugins();
  const restore = useMutation({
    mutationFn: () => window.pb.plugins.restoreDefaults(),
    onSuccess: refresh,
  });
  return (
    <button type="button" className={buttonStyles.secondary} onClick={() => restore.mutate()}>
      {t('plugins.restoreDefaults')}
    </button>
  );
}

function InstalledTab() {
  const { data = [] } = usePlugins();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <InstallFromFile />
        <RestoreDefaultsButton />
      </div>
      <ul className="space-y-3">
        {data.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </ul>
    </div>
  );
}

function TabPanel({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const { data = [] } = usePlugins();
  if (tab === 'installed') return <InstalledTab />;
  if (tab === 'developer') return <DeveloperTab plugins={data} />;
  return <p className="text-neutral-500">{t('plugins.storeLater')}</p>;
}

/**
 * Plugins screen (SPEC 8.1 #9): Installed, Store and Developer tabs.
 */
export function PluginsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('installed');
  return (
    <section className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{t('nav.plugins')}</h1>
      <TabList tab={tab} onChange={setTab} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <TabPanel tab={tab} />
      </div>
    </section>
  );
}
