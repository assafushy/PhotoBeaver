import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { TextField } from '../components/Field';

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Why a new password can't be used yet, or null when it's fine.
 *
 * @param password - The new password.
 * @param confirm - The same password typed again.
 * @returns An i18n key, or null.
 */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'auth.passwordTooShort';
  return password === confirm ? null : 'auth.passwordMismatch';
}

/**
 * State for choosing a new password: typed twice, checked on submit.
 *
 * @returns Both values, their setters, the shown problem and `validate()`.
 */
export function useNewPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const validate = (): boolean => {
    const found = passwordProblem(password, confirm);
    setProblem(found);
    return found === null;
  };
  return { password, setPassword, confirm, setConfirm, problem, validate };
}

export type NewPassword = ReturnType<typeof useNewPassword>;

/**
 * The two inputs for a new password and the problem with it, if any.
 *
 * @param props - The state from `useNewPassword`, the first label and the test id prefix.
 */
export function NewPasswordFields({
  state,
  label,
  testId,
}: {
  state: NewPassword;
  label: string;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <TextField
        type="password"
        label={label}
        value={state.password}
        onChange={state.setPassword}
        testId={testId}
      />
      <TextField
        type="password"
        label={t('auth.confirmPassword')}
        value={state.confirm}
        onChange={state.setConfirm}
        testId={`${testId}-confirm`}
      />
      {state.problem && <ErrorText>{t(state.problem)}</ErrorText>}
    </>
  );
}
