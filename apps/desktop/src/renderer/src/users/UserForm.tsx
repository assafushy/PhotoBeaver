import { ROLES, type Role, type UserSummary } from '@photobeaver/shared';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../components/ErrorText';
import { SelectField, TextField } from '../components/Field';
import { errorMessage } from '../lib/error-message';

const SECRET_KINDS = ['password', 'pin'] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

export interface UserFormState {
  displayName: string;
  role: Role;
  secretKind: SecretKind;
  secret: string;
  biometric: boolean;
  disabled: boolean;
}

export const EMPTY_USER: UserFormState = {
  displayName: '',
  role: 'viewer',
  secretKind: 'password',
  secret: '',
  biometric: false,
  disabled: false,
};

/**
 * The form state for editing an existing account (the secret starts empty,
 * meaning "keep the current one").
 *
 * @param user - The account.
 * @returns Form state.
 */
export function formFromUser(user: UserSummary): UserFormState {
  const { displayName, role, biometric, disabled } = user;
  return {
    displayName,
    role,
    secretKind: user.secretKind ?? 'password',
    secret: '',
    biometric,
    disabled,
  };
}

/**
 * Why the form can't be saved yet, or null.
 *
 * @param form - The form state.
 * @param secretRequired - Whether a password or PIN must be entered.
 * @returns An i18n key, or null.
 */
export function formProblem(form: UserFormState, secretRequired: boolean): string | null {
  if (!form.displayName.trim()) return 'users.nameRequired';
  if (!form.secret && !secretRequired) return null;
  if (form.secretKind === 'pin') return /^\d{4,8}$/.test(form.secret) ? null : 'auth.pinInvalid';
  return form.secret.length >= 8 ? null : 'auth.passwordTooShort';
}

/**
 * A validation problem or a core error (e.g. the last-Admin guard), inline.
 *
 * @param props - An i18n key for a local problem, or a core error.
 */
export function UserError({ problem, error }: { problem?: string | null; error?: unknown }) {
  const { t } = useTranslation();
  if (!problem && !error) return null;
  return (
    <div data-testid="user-error">
      <ErrorText>{problem ? t(problem) : errorMessage(error)}</ErrorText>
    </div>
  );
}

interface FieldsProps {
  form: UserFormState;
  onChange(patch: Partial<UserFormState>): void;
  editing: boolean;
}

function useRoleOptions() {
  const { t } = useTranslation();
  return ROLES.map((role) => ({ value: role, label: t(`users.role.${role}`) }));
}

function NameAndRole({ form, onChange }: Omit<FieldsProps, 'editing'>) {
  const { t } = useTranslation();
  return (
    <>
      <TextField
        label={t('users.name')}
        value={form.displayName}
        onChange={(displayName) => onChange({ displayName })}
        testId="user-name"
      />
      <SelectField
        label={t('users.roleLabel')}
        value={form.role}
        options={useRoleOptions()}
        onChange={(role) => onChange({ role })}
        testId="user-role"
      />
    </>
  );
}

function secretLabelKey(pin: boolean, editing: boolean): string {
  if (editing) return pin ? 'users.newPin' : 'users.newPassword';
  return pin ? 'auth.pin' : 'auth.password';
}

const digitsOnly = (value: string): string => value.replace(/\D/g, '').slice(0, 8);

function useSecretKindOptions() {
  const { t } = useTranslation();
  return SECRET_KINDS.map((kind) => ({ value: kind, label: t(`auth.${kind}`) }));
}

function SecretFields({ form, onChange, editing }: FieldsProps) {
  const { t } = useTranslation();
  const pin = form.secretKind === 'pin';
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <SelectField
        label={t('users.signInWith')}
        value={form.secretKind}
        options={useSecretKindOptions()}
        onChange={(secretKind) => onChange({ secretKind, secret: '' })}
        testId="user-secret-kind"
      />
      <TextField
        type="password"
        label={t(secretLabelKey(pin, editing))}
        value={form.secret}
        onChange={(secret) => onChange({ secret: pin ? digitsOnly(secret) : secret })}
        testId="user-secret"
      />
    </div>
  );
}

/**
 * Name, role and sign-in secret of an account; shared by Add and Edit.
 *
 * @param props - Form state, change handler, and whether an existing user is edited.
 */
export function UserFields(props: FieldsProps) {
  return (
    <div className="space-y-3">
      <NameAndRole form={props.form} onChange={props.onChange} />
      <SecretFields {...props} />
    </div>
  );
}
