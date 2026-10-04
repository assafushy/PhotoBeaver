import type { PluginSummary } from '@photobeaver/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { buttonStyles } from '../components/Modal';
import { PluginCard } from './PluginCard';
import { useRefreshPlugins } from './use-plugins';

function useDeveloperMode() {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ['developer-mode'],
    queryFn: () => window.pb.plugins.getDeveloperMode(),
  });
  const [local, setLocal] = useState<boolean | null>(null);
  const toggle = useMutation({
    mutationFn: (next: boolean) => window.pb.plugins.setDeveloperMode(next),
    onSettled: () => (setLocal(null), client.invalidateQueries({ queryKey: ['developer-mode'] })),
  });
  const change = (next: boolean) => (setLocal(next), toggle.mutate(next));
  return { enabled: local ?? data ?? false, change, error: toggle.error };
}

function DeveloperToggle() {
  const { t } = useTranslation();
  const { enabled, change, error } = useDeveloperMode();
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      {error && (
        <span role="alert" className="text-red-600">
          {error.message}
        </span>
      )}
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => change(e.target.checked)}
        data-testid="developer-mode"
      />
      {t('plugins.developerMode')}
    </label>
  );
}

function LoadUnpacked() {
  const { t } = useTranslation();
  const refresh = useRefreshPlugins();
  const load = useMutation({
    mutationFn: () => window.pb.plugins.loadUnpacked(),
    onSuccess: refresh,
  });
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={buttonStyles.primary}
        onClick={() => load.mutate()}
        disabled={load.isPending}
      >
        {t('plugins.loadUnpacked')}
      </button>
      {load.error && <ErrorText>{load.error.message}</ErrorText>}
    </div>
  );
}

/**
 * Developer tab (SPEC 5.4 "Dev", 5.5): developer mode, loading unpacked
 * plugins, and the plugins loaded that way with their reload buttons.
 */
export function DeveloperTab({ plugins }: { plugins: PluginSummary[] }) {
  const { t } = useTranslation();
  const devPlugins = plugins.filter((p) => p.installSource === 'dev');
  return (
    <div className="space-y-4">
      <DeveloperToggle />
      <p className="text-sm text-neutral-500">{t('plugins.developerHelp')}</p>
      <LoadUnpacked />
      <ul className="space-y-3">
        {devPlugins.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </ul>
    </div>
  );
}
