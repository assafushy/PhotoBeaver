import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonRow } from '../components/Button';
import { TextField } from '../components/Field';
import { NewPasswordFields, useNewPassword } from './NewPasswordFields';
import { AuthError } from './SecretForm';

function useRecovery() {
  const [recoveryKey, setRecoveryKey] = useState('');
  const newPassword = useNewPassword();
  const recover = useMutation({
    mutationFn: () => window.pb.auth.recover(recoveryKey.trim(), newPassword.password),
  });
  const submit = (event: FormEvent) => (
    event.preventDefault(),
    newPassword.validate() && recover.mutate()
  );
  return { recoveryKey, setRecoveryKey, newPassword, recover, submit };
}

function RecoveryButtons({ onBack, pending }: { onBack(): void; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <ButtonRow>
      <Button onClick={onBack}>{t('common.back')}</Button>
      <Button type="submit" variant="primary" disabled={pending} testId="recovery-submit">
        {t('auth.resetPassword')}
      </Button>
    </ButtonRow>
  );
}

/**
 * "Forgot password?": the recovery key resets the Admin's password and signs
 * them in.
 *
 * @param props - Called to go back to the user picker.
 */
export function RecoveryForm({ onBack }: { onBack(): void }) {
  const { t } = useTranslation();
  const { recoveryKey, setRecoveryKey, newPassword, recover, submit } = useRecovery();
  return (
    <form className="w-80 space-y-3" onSubmit={submit}>
      <p className="text-sm text-neutral-500">{t('auth.recoveryIntro')}</p>
      <TextField
        label={t('auth.recoveryKey')}
        value={recoveryKey}
        onChange={setRecoveryKey}
        testId="recovery-key"
      />
      <NewPasswordFields
        state={newPassword}
        label={t('auth.newPassword')}
        testId="recovery-password"
      />
      <AuthError error={recover.error} />
      <RecoveryButtons onBack={onBack} pending={recover.isPending} />
    </form>
  );
}
