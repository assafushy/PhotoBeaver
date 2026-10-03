import { validateConfig, type ConnectorInfo } from '@photobeaver/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonStyles, Modal } from '../components/Modal';
import { ConfigForm } from './ConfigForm';

function defaultsOf(connector: ConnectorInfo): Record<string, unknown> {
  const entries = Object.entries(connector.configSchema.properties ?? {}).filter(
    ([, f]) => f.default !== undefined,
  );
  return Object.fromEntries(entries.map(([key, field]) => [key, field.default]));
}

function ConnectorPicker({ onPick }: { onPick(c: ConnectorInfo): void }) {
  const { data = [] } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => window.pb.sources.connectors(),
  });
  return (
    <ul className="space-y-2">
      {data.map((connector) => (
        <li key={connector.id}>
          <button
            type="button"
            className="w-full rounded-md border border-neutral-200 p-3 text-left hover:border-amber-500 dark:border-neutral-700"
            onClick={() => onPick(connector)}
          >
            <div className="font-medium">{connector.name}</div>
            <div className="text-sm text-neutral-500">{connector.description}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface SetupStepProps {
  connector: ConnectorInfo;
  onDone(): void;
  onBack(): void;
}

function useSetupForm(connector: ConnectorInfo, onDone: () => void) {
  const client = useQueryClient();
  const [values, setValues] = useState(() => defaultsOf(connector));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      window.pb.sources.add({ pluginId: connector.id, config }),
    onSuccess: () => (void client.invalidateQueries({ queryKey: ['sources'] }), onDone()),
  });
  const submit = () => {
    const result = validateConfig(connector.configSchema, values);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) add.mutate(result.value);
  };
  const change = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));
  return { values, errors, add, submit, change };
}

function SetupActions({ pending, onBack }: { pending: boolean; onBack(): void }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={buttonStyles.secondary} onClick={onBack}>
        {t('common.back')}
      </button>
      <button type="submit" className={buttonStyles.primary} disabled={pending}>
        {t('sources.add')}
      </button>
    </div>
  );
}

function SetupStep({ connector, onDone, onBack }: SetupStepProps) {
  const { values, errors, add, submit, change } = useSetupForm(connector, onDone);
  return (
    <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4">
      <ConfigForm
        schema={connector.configSchema}
        values={values}
        errors={errors}
        onChange={change}
      />
      {add.error && (
        <p role="alert" className="text-sm text-red-600">
          {add.error.message}
        </p>
      )}
      <SetupActions pending={add.isPending} onBack={onBack} />
    </form>
  );
}

function DialogStep({
  connector,
  onPick,
  ...rest
}: Omit<SetupStepProps, 'connector'> & {
  connector: ConnectorInfo | null;
  onPick(c: ConnectorInfo): void;
}) {
  if (!connector) return <ConnectorPicker onPick={onPick} />;
  return <SetupStep connector={connector} {...rest} />;
}

/**
 * "Add source" flow (SPEC 8.1 Sources): pick an installed connector, then fill its
 * config form; the connector's setup runs in core and the first sync starts.
 */
export function AddSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const [connector, setConnector] = useState<ConnectorInfo | null>(null);
  const close = (next: boolean) => (onOpenChange(next), next ? undefined : setConnector(null));
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={connector ? connector.name : t('sources.addTitle')}
      description={connector ? undefined : t('sources.addDescription')}
    >
      <DialogStep
        connector={connector}
        onPick={setConnector}
        onDone={() => close(false)}
        onBack={() => setConnector(null)}
      />
    </Modal>
  );
}
