import type { StagedPackageSummary } from '@photobeaver/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { buttonStyles, Modal } from '../components/Modal';
import { PermissionList } from './PermissionList';
import { useRefreshPlugins } from './use-plugins';

function ConsentBody({ staged }: { staged: StagedPackageSummary }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 text-sm">
      <p
        className="rounded bg-amber-100 p-2 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        role="alert"
      >
        {t('plugins.unverified')}
      </p>
      <p>{`${staged.name} ${staged.version}${staged.author ? ` · ${staged.author}` : ''}`}</p>
      {staged.replacesVersion && (
        <p>{t('plugins.replaces', { version: staged.replacesVersion })}</p>
      )}
      <PermissionList permissions={staged.permissions} />
      <p className="text-xs break-all text-neutral-500">{`SHA-256 ${staged.sha256}`}</p>
    </div>
  );
}

function useInstallStaged(staged: StagedPackageSummary, onClose: () => void) {
  const refresh = useRefreshPlugins();
  return useMutation({
    mutationFn: () => window.pb.plugins.installStaged(staged.token),
    onSuccess: () => (refresh(), onClose()),
  });
}

function ConsentButtons({
  installing,
  onCancel,
  onInstall,
}: {
  installing: boolean;
  onCancel(): void;
  onInstall(): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
        {t('common.cancel')}
      </button>
      <button
        type="button"
        className={buttonStyles.primary}
        disabled={installing}
        onClick={onInstall}
      >
        {t('plugins.install')}
      </button>
    </div>
  );
}

function ConsentDialog({ staged, onClose }: { staged: StagedPackageSummary; onClose(): void }) {
  const { t } = useTranslation();
  const install = useInstallStaged(staged, onClose);
  const cancel = () => (void window.pb.plugins.discardStaged(staged.token), onClose());
  return (
    <Modal
      open
      onOpenChange={(open) => !open && cancel()}
      title={t('plugins.consentTitle', { name: staged.name })}
    >
      <ConsentBody staged={staged} />
      {install.error && (
        <ErrorText className="mt-3 text-sm text-red-600">{install.error.message}</ErrorText>
      )}
      <ConsentButtons
        installing={install.isPending}
        onCancel={cancel}
        onInstall={() => install.mutate()}
      />
    </Modal>
  );
}

function useStagedPackage() {
  const [staged, setStaged] = useState<StagedPackageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    setError(null);
    const file = await window.pb.plugins.pickPackage();
    if (file)
      await window.pb.plugins
        .inspectPackage(file)
        .then(setStaged, (e: Error) => setError(e.message));
  };
  return { staged, error, choose, clear: () => setStaged(null) };
}

/**
 * "Install from file" (SPEC 5.4): pick a `.pbplugin`, review its permissions,
 * then install. File installs are unverified and say so.
 */
export function InstallFromFile() {
  const { t } = useTranslation();
  const { staged, error, choose, clear } = useStagedPackage();
  return (
    <>
      <button type="button" className={buttonStyles.primary} onClick={() => void choose()}>
        {t('plugins.installFromFile')}
      </button>
      {error && <ErrorText>{error}</ErrorText>}
      {staged && <ConsentDialog staged={staged} onClose={clear} />}
    </>
  );
}
