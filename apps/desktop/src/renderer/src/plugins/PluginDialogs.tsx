import type { PluginSummary } from '@photobeaver/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { buttonStyles, Modal } from '../components/Modal';
import { useRefreshPlugins } from './use-plugins';

function LogsDialog({
  plugin,
  open,
  onOpenChange,
}: {
  plugin: PluginSummary;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['plugin-logs', plugin.id],
    queryFn: () => window.pb.plugins.logs(plugin.id, 300),
    enabled: open,
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('plugins.logsTitle', { name: plugin.name })}
    >
      <pre className="max-h-96 overflow-auto rounded bg-neutral-100 p-2 text-xs whitespace-pre-wrap dark:bg-neutral-800">
        {data || t('plugins.noLogs')}
      </pre>
    </Modal>
  );
}

/**
 * Shows the tail of a plugin's log file.
 */
export function LogsButton({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t('plugins.viewLogs')}
      </button>
      <LogsDialog plugin={plugin} open={open} onOpenChange={setOpen} />
    </>
  );
}

function useUninstall(plugin: PluginSummary, onDone: () => void) {
  const refresh = useRefreshPlugins();
  const uninstall = useMutation({
    mutationFn: (removeData: boolean) => window.pb.plugins.uninstall(plugin.id, removeData),
    onSuccess: () => (refresh(), onDone()),
  });
  const choice = (removeData: boolean) => ({
    disabled: uninstall.isPending,
    onClick: () => uninstall.mutate(removeData),
  });
  return { error: uninstall.error, choice };
}

function UninstallActions({ plugin, onDone }: { plugin: PluginSummary; onDone(): void }) {
  const { t } = useTranslation();
  const { error, choice } = useUninstall(plugin, onDone);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={buttonStyles.secondary} onClick={onDone}>
        {t('common.cancel')}
      </button>
      <button type="button" className={buttonStyles.secondary} {...choice(false)}>
        {t('plugins.keepData')}
      </button>
      <button type="button" className={buttonStyles.danger} {...choice(true)}>
        {t('plugins.removeData')}
      </button>
      {error && <ErrorText className="w-full text-sm text-red-600">{error.message}</ErrorText>}
    </div>
  );
}

/**
 * Uninstall with the SPEC 5.4 question: keep or remove the data the plugin produced.
 */
export function UninstallButton({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t('plugins.uninstall')}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('plugins.uninstallTitle', { name: plugin.name })}
        description={t('plugins.uninstallBody', { count: plugin.sourceCount })}
      >
        <UninstallActions plugin={plugin} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
