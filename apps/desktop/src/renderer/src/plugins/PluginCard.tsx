import type { PluginSummary } from '@photobeaver/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { buttonStyles } from '../components/Modal';
import { PermissionList } from './PermissionList';
import { LogsButton, UninstallButton } from './PluginDialogs';
import { useRefreshPlugins } from './use-plugins';

const STATUS_STYLE: Record<PluginSummary['status'], string> = {
  ok: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  disabled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  crashed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  invalid: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  uninstalled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

function Header({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="font-semibold">{plugin.name}</h2>
        <p className="text-xs text-neutral-500">{`${plugin.id} · ${plugin.version} · ${t(`plugins.source.${plugin.installSource}`)}`}</p>
      </div>
      <span
        className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[plugin.status]}`}
        data-testid="plugin-status"
      >
        {t(`plugins.status.${plugin.status}`)}
      </span>
    </div>
  );
}

function useRefreshingMutation(mutationFn: () => Promise<unknown>) {
  const refresh = useRefreshPlugins();
  return useMutation({ mutationFn, onSuccess: refresh });
}

function ReEnableButton({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  const reEnable = useRefreshingMutation(() => window.pb.plugins.reEnable(plugin.id));
  return (
    <button type="button" className={buttonStyles.primary} onClick={() => reEnable.mutate()}>
      {t('plugins.reEnable')}
    </button>
  );
}

function ToggleButton({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  const toggle = useRefreshingMutation(() =>
    window.pb.plugins.setEnabled(plugin.id, !plugin.enabled),
  );
  return (
    <button
      type="button"
      className={buttonStyles.secondary}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate()}
    >
      {t(plugin.enabled ? 'plugins.disable' : 'plugins.enable')}
    </button>
  );
}

function ReloadButton({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  const reload = useRefreshingMutation(() => window.pb.plugins.reload(plugin.id));
  return (
    <button type="button" className={buttonStyles.secondary} onClick={() => reload.mutate()}>
      {t('plugins.reload')}
    </button>
  );
}

function PrimaryActions({ plugin }: { plugin: PluginSummary }) {
  if (plugin.status === 'uninstalled') return null;
  return (
    <>
      {plugin.status === 'crashed' && <ReEnableButton plugin={plugin} />}
      <ToggleButton plugin={plugin} />
      {plugin.installSource === 'dev' && <ReloadButton plugin={plugin} />}
    </>
  );
}

function Details({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  return (
    <>
      {plugin.description && (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{plugin.description}</p>
      )}
      {plugin.error && <ErrorText>{plugin.error}</ErrorText>}
      {plugin.status === 'crashed' && <ErrorText>{t('plugins.crashedBody')}</ErrorText>}
      {plugin.permissions && <PermissionList permissions={plugin.permissions} />}
      <p className="text-xs text-neutral-500">
        {t(plugin.running ? 'plugins.running' : 'plugins.stopped', { count: plugin.restarts })}
      </p>
    </>
  );
}

/**
 * One installed plugin (SPEC 8.1 #9): status, permissions and actions.
 */
export function PluginCard({ plugin }: { plugin: PluginSummary }) {
  return (
    <li
      className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
      data-testid="plugin-card"
      data-plugin-id={plugin.id}
    >
      <Header plugin={plugin} />
      <Details plugin={plugin} />
      <div className="flex flex-wrap gap-2">
        <PrimaryActions plugin={plugin} />
        <LogsButton plugin={plugin} />
        <UninstallButton plugin={plugin} />
      </div>
    </li>
  );
}
