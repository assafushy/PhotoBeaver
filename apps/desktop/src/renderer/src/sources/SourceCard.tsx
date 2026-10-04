import type { PbEvents, SourceSummary } from '@photobeaver/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { buttonStyles, Modal } from '../components/Modal';
import { SetupError, SetupWaiting } from './SetupWaiting';
import { useCancellableSetup } from './use-setup';

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(timestamp: number | null): string {
  if (timestamp === null) return '';
  const minutes = Math.round((timestamp - Date.now()) / 60_000);
  return Math.abs(minutes) < 60
    ? relative.format(minutes, 'minute')
    : relative.format(Math.round(minutes / 60), 'hour');
}

function StatusLine({
  source,
  progress,
}: {
  source: SourceSummary;
  progress?: PbEvents['sync.progress'];
}) {
  const { t } = useTranslation();
  const running = source.syncState === 'running';
  return (
    <p className="text-sm text-neutral-500" data-testid="source-status">
      <span className="font-medium">{t(`sources.state.${source.syncState}`)}</span>
      {running && progress ? ` · ${t('sources.scanned', { count: progress.done })}` : ''}
      {!running && source.lastSyncFinishedAt
        ? ` · ${t('sources.lastSync', { when: ago(source.lastSyncFinishedAt) })}`
        : ''}
    </p>
  );
}

type Progress = PbEvents['sync.progress'];

function ConfirmRemoveActions({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <button type="button" className={buttonStyles.danger} disabled={pending} onClick={onConfirm}>
        {t('sources.remove')}
      </button>
    </div>
  );
}

function RemoveModal({
  source,
  open,
  setOpen,
}: {
  source: SourceSummary;
  open: boolean;
  setOpen(open: boolean): void;
}) {
  const { t } = useTranslation();
  const remove = useMutation({
    mutationFn: () => window.pb.sources.remove(source.id),
    onSuccess: () => setOpen(false),
  });
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('sources.removeTitle', { name: source.displayName })}
      description={t('sources.removeBody')}
    >
      <ConfirmRemoveActions
        pending={remove.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </Modal>
  );
}

function RemoveButton({ source }: { source: SourceSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonStyles.secondary} onClick={() => setOpen(true)}>
        {t('sources.remove')}
      </button>
      <RemoveModal source={source} open={open} setOpen={setOpen} />
    </>
  );
}

function togglePause(source: SourceSummary, paused: boolean): void {
  void (paused ? window.pb.sources.resume(source.id) : window.pb.sources.pause(source.id));
}

function SyncNowButton({ source }: { source: SourceSummary }) {
  const { t } = useTranslation();
  const busy = source.syncState === 'running' || source.syncState === 'queued';
  return (
    <button
      type="button"
      className={buttonStyles.primary}
      disabled={busy}
      onClick={() => void window.pb.sources.syncNow(source.id)}
    >
      {t('sources.syncNow')}
    </button>
  );
}

function ReconnectButton({ source, usesOAuth }: { source: SourceSummary; usesOAuth: boolean }) {
  const { t } = useTranslation();
  const setup = useCancellableSetup(
    (_: void, setupId: string) => window.pb.sources.reconnect(source.id, setupId),
    () => undefined,
  );
  if (setup.mutation.isPending)
    return <SetupWaiting usesOAuth={usesOAuth} onCancel={setup.cancel} />;
  return (
    <>
      <button
        type="button"
        className={buttonStyles.primary}
        onClick={() => setup.mutation.mutate()}
      >
        {t('sources.reconnect')}
      </button>
      {setup.error && <SetupError error={setup.error} />}
    </>
  );
}

function Actions({ source, usesOAuth }: { source: SourceSummary; usesOAuth: boolean }) {
  const { t } = useTranslation();
  const paused = source.syncState === 'paused';
  const needsAuth = source.syncState === 'auth_required';
  return (
    <div className="flex flex-wrap gap-2">
      {needsAuth && <ReconnectButton source={source} usesOAuth={usesOAuth} />}
      {!paused && !needsAuth && <SyncNowButton source={source} />}
      <button
        type="button"
        className={buttonStyles.secondary}
        onClick={() => togglePause(source, paused)}
      >
        {t(paused ? 'sources.resume' : 'sources.pause')}
      </button>
      <RemoveButton source={source} />
    </div>
  );
}

function SourceAlerts({ source }: { source: SourceSummary }) {
  const { t } = useTranslation();
  return (
    <>
      {!source.connectorAvailable && <ErrorText>{t('sources.connectorMissing')}</ErrorText>}
      {source.lastError && (
        <ErrorText className="mt-1 text-sm text-red-600">{source.lastError}</ErrorText>
      )}
    </>
  );
}

function SourceDetails({ source, progress }: { source: SourceSummary; progress?: Progress }) {
  return (
    <div className="min-w-0">
      <h2 className="font-semibold">{source.displayName}</h2>
      <p className="truncate text-sm text-neutral-500" title={source.location ?? ''}>
        {source.connectorName}
        {source.location ? ` · ${source.location}` : ''}
      </p>
      <StatusLine source={source} progress={progress} />
      <SourceAlerts source={source} />
    </div>
  );
}

/**
 * One connected source: name, location, item count, status, live progress and actions.
 */
function useUsesOAuth(pluginId: string): boolean {
  const { data } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => window.pb.sources.connectors(),
  });
  return data?.find((connector) => connector.id === pluginId)?.usesOAuth ?? false;
}

export function SourceCard({ source, progress }: { source: SourceSummary; progress?: Progress }) {
  const { t } = useTranslation();
  return (
    <li
      className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
      data-testid="source-card"
    >
      <div className="flex items-start justify-between gap-4">
        <SourceDetails source={source} progress={progress} />
        <span className="shrink-0 text-sm text-neutral-500" data-testid="source-count">
          {t('library.count', { count: source.itemCount })}
        </span>
      </div>
      <Actions source={source} usesOAuth={useUsesOAuth(source.pluginId)} />
    </li>
  );
}
