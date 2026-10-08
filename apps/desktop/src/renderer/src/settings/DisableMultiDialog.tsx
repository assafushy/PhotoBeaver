import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonRow } from '../components/Button';
import { ErrorText } from '../components/ErrorText';
import { TextField } from '../components/Field';
import { Modal } from '../components/Modal';
import { errorMessage } from '../lib/error-message';
import { USERS_SETTINGS_KEY } from './use-users-settings';

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

function useDisable(onDone: () => void) {
  const client = useQueryClient();
  const [password, setPassword] = useState('');
  const disable = useMutation({
    mutationFn: () => window.pb.users.disableMulti(password),
    onSuccess: () => (onDone(), void client.invalidateQueries({ queryKey: USERS_SETTINGS_KEY })),
  });
  const submit = (event: FormEvent) => (event.preventDefault(), disable.mutate());
  return { password, setPassword, disable, submit };
}

function DisableButtons({ onCancel, pending }: { onCancel(): void; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <ButtonRow>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button type="submit" variant="danger" disabled={pending} testId="disable-multiuser">
        {t('settings.users.disable')}
      </Button>
    </ButtonRow>
  );
}

function DisableForm({ onCancel }: { onCancel(): void }) {
  const { t } = useTranslation();
  const { password, setPassword, disable, submit } = useDisable(onCancel);
  return (
    <form className="space-y-3" onSubmit={submit}>
      <TextField
        type="password"
        label={t('auth.password')}
        value={password}
        onChange={setPassword}
        testId="disable-password"
      />
      {disable.error && <ErrorText>{errorMessage(disable.error)}</ErrorText>}
      <DisableButtons onCancel={onCancel} pending={disable.isPending} />
    </form>
  );
}

/**
 * Turning multiple users off: the Admin confirms with their password, and the
 * app goes back to opening straight in. Accounts are kept.
 *
 * @param props - Open state and its setter.
 */
export function DisableMultiDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.users.disableTitle')}
      description={t('settings.users.disableBody')}
    >
      <DisableForm onCancel={() => onOpenChange(false)} />
    </Modal>
  );
}
