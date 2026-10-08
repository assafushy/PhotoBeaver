import type { UserSummary } from '@photobeaver/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonRow } from '../components/Button';
import { CheckboxField } from '../components/Field';
import { Modal } from '../components/Modal';
import { ScopeEditor } from './ScopeEditor';
import { useUserActions, type UserChanges } from './use-users';
import {
  EMPTY_USER,
  formFromUser,
  formProblem,
  UserError,
  UserFields,
  type UserFormState,
} from './UserForm';

interface DialogProps {
  onClose(): void;
}

function UserModal(
  props: DialogProps & { title: string; description?: string; children: ReactNode },
) {
  return (
    <Modal
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={props.title}
      description={props.description}
    >
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">{props.children}</div>
    </Modal>
  );
}

function useForm(initial: UserFormState) {
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const patch = (changes: Partial<UserFormState>) =>
    setForm((current) => ({ ...current, ...changes }));
  const check = (secretRequired: boolean) => {
    const found = formProblem(form, secretRequired);
    setProblem(found);
    return !found;
  };
  return { form, patch, problem, check };
}

function SaveButtons({
  onCancel,
  pending,
  children,
}: {
  onCancel(): void;
  pending: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <ButtonRow>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
      <Button type="submit" variant="primary" disabled={pending} testId="save-user">
        {children}
      </Button>
    </ButtonRow>
  );
}

function useAddUser(onClose: () => void) {
  const { form, patch, problem, check } = useForm(EMPTY_USER);
  const { create } = useUserActions(onClose);
  const { displayName, role, secret, secretKind } = form;
  const submit = (event: FormEvent) => (
    event.preventDefault(),
    check(true) && create.mutate({ displayName: displayName.trim(), role, secret, secretKind })
  );
  return { form, patch, problem, create, submit };
}

/**
 * "Add user": name, role and a password or PIN.
 *
 * @param props - Called when the dialog closes.
 */
export function AddUserDialog({ onClose }: DialogProps) {
  const { t } = useTranslation();
  const { form, patch, problem, create, submit } = useAddUser(onClose);
  return (
    <UserModal onClose={onClose} title={t('users.addTitle')}>
      <form className="space-y-3" onSubmit={submit}>
        <UserFields form={form} onChange={patch} editing={false} />
        <UserError problem={problem} error={create.error} />
        <SaveButtons onCancel={onClose} pending={create.isPending}>
          {t('users.add')}
        </SaveButtons>
      </form>
    </UserModal>
  );
}

function changesFor(user: UserSummary, form: UserFormState): UserChanges {
  const { biometric, disabled, role } = form;
  const secret = form.secret ? { secret: form.secret, secretKind: form.secretKind } : {};
  return {
    id: user.id,
    displayName: form.displayName.trim(),
    role,
    biometric,
    disabled,
    ...secret,
  };
}

interface TogglesProps {
  form: UserFormState;
  patch(changes: Partial<UserFormState>): void;
  biometricAvailable: boolean;
}

function AccountToggles({ form, patch, biometricAvailable }: TogglesProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-4">
      {biometricAvailable && (
        <CheckboxField
          label={t('users.touchId')}
          checked={form.biometric}
          onChange={(biometric) => patch({ biometric })}
          testId="user-biometric"
        />
      )}
      <CheckboxField
        label={t('users.disabledLabel')}
        checked={form.disabled}
        onChange={(disabled) => patch({ disabled })}
        testId="user-disabled"
      />
    </div>
  );
}

function useEditUser(user: UserSummary, onClose: () => void) {
  const { form, patch, problem, check } = useForm(formFromUser(user));
  const { update } = useUserActions(onClose);
  const submit = (event: FormEvent) => (
    event.preventDefault(),
    check(false) && update.mutate(changesFor(user, form))
  );
  return { form, patch, problem, update, submit };
}

interface EditProps extends DialogProps {
  user: UserSummary;
  biometricAvailable: boolean;
}

function EditForm({ user, biometricAvailable, onClose }: EditProps) {
  const { t } = useTranslation();
  const { form, patch, problem, update, submit } = useEditUser(user, onClose);
  return (
    <form className="space-y-3" onSubmit={submit}>
      <UserFields form={form} onChange={patch} editing />
      <AccountToggles form={form} patch={patch} biometricAvailable={biometricAvailable} />
      <UserError problem={problem} error={update.error} />
      <SaveButtons onCancel={onClose} pending={update.isPending}>
        {t('common.save')}
      </SaveButtons>
    </form>
  );
}

/**
 * "Edit user": name, role, a new password or PIN, Touch ID, disabled, and
 * (for Viewers and Editors) what they can see.
 *
 * @param props - The user, whether Touch ID exists here, and the close handler.
 */
export function EditUserDialog(props: EditProps) {
  const { t } = useTranslation();
  const { user, onClose } = props;
  return (
    <UserModal onClose={onClose} title={t('users.editTitle', { name: user.displayName })}>
      <EditForm {...props} />
      {user.role !== 'admin' && <ScopeEditor user={user} onSaved={onClose} />}
    </UserModal>
  );
}

/**
 * Confirms deleting an account. Core refuses to delete the last Admin.
 *
 * @param props - The user and the close handler.
 */
export function DeleteUserDialog({ user, onClose }: DialogProps & { user: UserSummary }) {
  const { t } = useTranslation();
  const { remove } = useUserActions(onClose);
  const title = t('users.deleteTitle', { name: user.displayName });
  return (
    <UserModal onClose={onClose} title={title} description={t('users.deleteBody')}>
      <UserError error={remove.error} />
      <ButtonRow>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate(user.id)}
          testId="confirm-delete-user"
        >
          {t('users.delete')}
        </Button>
      </ButtonRow>
    </UserModal>
  );
}
