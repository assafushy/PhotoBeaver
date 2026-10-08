import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { NewPasswordFields, useNewPassword } from '../auth/NewPasswordFields';
import { Button, ButtonRow } from '../components/Button';
import { ErrorText } from '../components/ErrorText';
import { Modal } from '../components/Modal';
import { errorMessage } from '../lib/error-message';
import { SESSION_KEY } from '../session/use-session';
import { USERS_SETTINGS_KEY } from './use-users-settings';

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

type Enable = ReturnType<typeof useEnable>;

function useEnable() {
  const newPassword = useNewPassword();
  const enable = useMutation({
    mutationFn: () => window.pb.users.enableMulti(newPassword.password),
  });
  const submit = (event: FormEvent) => (
    event.preventDefault(),
    newPassword.validate() && enable.mutate()
  );
  return { newPassword, enable, submit };
}

function PasswordStep({ state }: { state: Enable }) {
  const { t } = useTranslation();
  const { newPassword, enable, submit } = state;
  return (
    <form className="space-y-3" onSubmit={submit}>
      <NewPasswordFields state={newPassword} label={t('auth.password')} testId="admin-password" />
      {enable.error && <ErrorText>{errorMessage(enable.error)}</ErrorText>}
      <ButtonRow>
        <Button
          type="submit"
          variant="primary"
          disabled={enable.isPending}
          testId="enable-multiuser"
        >
          {t('settings.users.enable')}
        </Button>
      </ButtonRow>
    </form>
  );
}

function KeyDisplay({ recoveryKey }: { recoveryKey: string }) {
  return (
    <code
      className="block rounded-md bg-neutral-100 p-3 text-center font-mono text-lg tracking-wider select-all dark:bg-neutral-800"
      data-testid="recovery-key-display"
    >
      {recoveryKey}
    </code>
  );
}

function KeyStep({ recoveryKey, onSaved }: { recoveryKey: string; onSaved(): void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(recoveryKey).then(() => setCopied(true));
  return (
    <div className="space-y-3">
      <p className="text-sm">{t('settings.users.recoveryKeyBody')}</p>
      <KeyDisplay recoveryKey={recoveryKey} />
      <ButtonRow>
        <Button onClick={copy} testId="recovery-copy">
          {t(copied ? 'settings.users.copied' : 'settings.users.copy')}
        </Button>
        <Button variant="primary" onClick={onSaved} testId="recovery-saved">
          {t('settings.users.savedIt')}
        </Button>
      </ButtonRow>
    </div>
  );
}

function useFinish(onOpenChange: (open: boolean) => void) {
  const client = useQueryClient();
  return () => {
    onOpenChange(false);
    void client.invalidateQueries({ queryKey: USERS_SETTINGS_KEY });
    void client.invalidateQueries({ queryKey: SESSION_KEY });
  };
}

/**
 * Turning on multiple users (SPEC 3.3): set the Admin password, then show the
 * one-time recovery key until the Admin confirms they saved it.
 *
 * @param props - Open state and its setter.
 */
export function EnableMultiDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation();
  const state = useEnable();
  const finish = useFinish(onOpenChange);
  const recoveryKey = state.enable.data?.recoveryKey ?? null;
  const keyStep = recoveryKey !== null;
  return (
    <Modal
      open={open}
      onOpenChange={(next) => !keyStep && onOpenChange(next)}
      title={t(keyStep ? 'settings.users.recoveryKeyTitle' : 'settings.users.enableTitle')}
      description={keyStep ? undefined : t('settings.users.enableBody')}
    >
      {keyStep ? (
        <KeyStep recoveryKey={recoveryKey} onSaved={finish} />
      ) : (
        <PasswordStep state={state} />
      )}
    </Modal>
  );
}
