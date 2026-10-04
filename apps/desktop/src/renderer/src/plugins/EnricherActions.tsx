import { validateConfig, type PluginSettingsView, type PluginSummary } from '@photobeaver/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { buttonStyles, Modal } from '../components/Modal';
import { ConfigForm } from '../sources/ConfigForm';
import { useRefreshPlugins } from './use-plugins';

function useSettingsForm(plugin: PluginSummary, view: PluginSettingsView, onDone: () => void) {
  const [values, setValues] = useState(view.values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => window.pb.plugins.setSettings(plugin.id, values),
    onSuccess: onDone,
  });
  const submit = () => {
    const result = validateConfig(view.configSchema, values);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) save.mutate();
  };
  const change = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  return { values, errors, save, submit, change };
}

function SettingsForm({
  plugin,
  view,
  onDone,
}: {
  plugin: PluginSummary;
  view: PluginSettingsView;
  onDone(): void;
}) {
  const { t } = useTranslation();
  const { values, errors, save, submit, change } = useSettingsForm(plugin, view, onDone);
  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), submit())}>
      <ConfigForm schema={view.configSchema} values={values} errors={errors} onChange={change} />
      {save.isError && <ErrorText>{String(save.error)}</ErrorText>}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonStyles.secondary} onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={buttonStyles.primary} disabled={save.isPending}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

function SettingsDialog({
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
    queryKey: ['plugin-settings', plugin.id],
    queryFn: () => window.pb.plugins.getSettings(plugin.id),
    enabled: open,
    gcTime: 0,
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('plugins.settingsTitle', { name: plugin.name })}
    >
      {data && <SettingsForm plugin={plugin} view={data} onDone={() => onOpenChange(false)} />}
    </Modal>
  );
}

/**
 * Opens the plugin's settings form, built from its `configSchema`.
 */
export function SettingsButton({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!plugin.hasSettings) return null;
  return (
    <>
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t('plugins.settings')}
      </button>
      {open && <SettingsDialog plugin={plugin} open={open} onOpenChange={setOpen} />}
    </>
  );
}

/**
 * Queues the enricher for every asset again, for example after an update (SPEC 6.3).
 */
export function RerunButton({ plugin }: { plugin: PluginSummary }) {
  const { t } = useTranslation();
  const refresh = useRefreshPlugins();
  const rerun = useMutation({
    mutationFn: () => window.pb.plugins.rerun(plugin.id),
    onSuccess: refresh,
  });
  if (plugin.type !== 'enricher' || !plugin.enabled) return null;
  return (
    <button
      type="button"
      className={buttonStyles.secondary}
      disabled={rerun.isPending}
      onClick={() => rerun.mutate()}
    >
      {t('plugins.rerun')}
    </button>
  );
}
