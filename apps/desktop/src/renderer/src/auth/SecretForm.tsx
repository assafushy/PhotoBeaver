import type { PickerUser } from '@photobeaver/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { inputStyle } from '../components/Field';
import { buttonStyles } from '../components/Modal';
import { errorMessage } from '../lib/error-message';

const PIN_PATTERN = /^\d{4,8}$/;

/**
 * A failed sign-in or recovery, shown under the form.
 *
 * @param props - The error, if any.
 */
export function AuthError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div data-testid="signin-error">
      <ErrorText>{errorMessage(error)}</ErrorText>
    </div>
  );
}

function SecretInput({ user, value, onChange }: SecretInputProps) {
  const { t } = useTranslation();
  const pin = user.secretKind === 'pin';
  return (
    <input
      autoFocus
      type="password"
      aria-label={t(pin ? 'auth.pin' : 'auth.password')}
      placeholder={t(pin ? 'auth.pin' : 'auth.password')}
      inputMode={pin ? 'numeric' : undefined}
      maxLength={pin ? 8 : 200}
      className={`${inputStyle} ${pin ? 'text-center tracking-[0.5em]' : ''}`}
      value={value}
      onChange={(e) => onChange(pin ? e.target.value.replace(/\D/g, '') : e.target.value)}
      data-testid="signin-secret"
    />
  );
}

interface SecretInputProps {
  user: PickerUser;
  value: string;
  onChange(value: string): void;
}

function TouchIdButton({ user }: { user: PickerUser }) {
  const { t } = useTranslation();
  const biometric = useMutation({ mutationFn: () => window.pb.auth.signInBiometric(user.id) });
  return (
    <>
      <button
        type="button"
        className={buttonStyles.secondary}
        disabled={biometric.isPending}
        onClick={() => biometric.mutate()}
        data-testid="touchid-button"
      >
        {t('auth.useTouchId')}
      </button>
      <AuthError error={biometric.error} />
    </>
  );
}

function useSignIn(user: PickerUser) {
  const [secret, setSecret] = useState('');
  const signIn = useMutation({
    mutationFn: () => window.pb.auth.signIn(user.id, secret),
    onError: () => setSecret(''),
  });
  const ready = user.secretKind === 'pin' ? PIN_PATTERN.test(secret) : secret.length > 0;
  const submit = (event: FormEvent) => (event.preventDefault(), ready && signIn.mutate());
  return { secret, setSecret, signIn, ready, submit };
}

/**
 * Password or PIN entry for the chosen user, plus Touch ID when they turned it on.
 *
 * @param props - The user signing in.
 */
export function SecretForm({ user }: { user: PickerUser }) {
  const { t } = useTranslation();
  const { secret, setSecret, signIn, ready, submit } = useSignIn(user);
  return (
    <form className="w-72 space-y-3" onSubmit={submit}>
      <SecretInput user={user} value={secret} onChange={setSecret} />
      <button
        type="submit"
        className={`${buttonStyles.primary} w-full`}
        disabled={!ready || signIn.isPending}
        data-testid="signin-submit"
      >
        {t('auth.signIn')}
      </button>
      {user.biometric && <TouchIdButton user={user} />}
      <AuthError error={signIn.error} />
    </form>
  );
}
