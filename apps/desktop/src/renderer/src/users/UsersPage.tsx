import type { UserSummary } from '@photobeaver/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Avatar } from '../auth/Avatar';
import { Button } from '../components/Button';
import { formatInstant } from '../library/dates';
import { useUsersSettings } from '../settings/use-users-settings';
import { useUsers } from './use-users';
import { AddUserDialog, DeleteUserDialog, EditUserDialog } from './UserDialogs';

type Dialog = { kind: 'add' } | { kind: 'edit' | 'delete'; user: UserSummary } | null;

const HEADERS = [
  'users.name',
  'users.roleLabel',
  'users.signInWith',
  'users.touchId',
  'users.status',
  'users.lastSignIn',
];
const cell = 'px-2 py-2';

type Translate = (key: string) => string;

function cellTexts(user: UserSummary, t: Translate): string[] {
  const kind = user.secretKind ? t(`auth.${user.secretKind}`) : t('users.noSecret');
  return [
    t(`users.role.${user.role}`),
    kind,
    t(user.biometric ? 'users.on' : 'users.off'),
    t(user.disabled ? 'users.disabled' : 'users.active'),
    user.lastLoginAt === null ? t('users.never') : formatInstant(user.lastLoginAt),
  ];
}

function UserCells({ user }: { user: UserSummary }) {
  const { t } = useTranslation();
  return (
    <>
      <td className={cell}>
        <span className="flex items-center gap-2 font-medium">
          <Avatar name={user.displayName} size="sm" />
          {user.displayName}
        </span>
      </td>
      {cellTexts(user, t).map((text, index) => (
        <td key={HEADERS[index + 1]} className={cell}>
          {text}
        </td>
      ))}
    </>
  );
}

function UserRow({ user, onOpen }: { user: UserSummary; onOpen(dialog: Dialog): void }) {
  const { t } = useTranslation();
  return (
    <tr
      className="border-t border-neutral-200 dark:border-neutral-800"
      data-testid="user-row"
      data-user-id={user.id}
    >
      <UserCells user={user} />
      <td className={`${cell} space-x-2 text-right whitespace-nowrap`}>
        <Button onClick={() => onOpen({ kind: 'edit', user })} testId="edit-user">
          {t('users.edit')}
        </Button>
        <Button onClick={() => onOpen({ kind: 'delete', user })} testId="delete-user">
          {t('users.delete')}
        </Button>
      </td>
    </tr>
  );
}

function TableHead() {
  const { t } = useTranslation();
  return (
    <thead className="text-xs text-neutral-500">
      <tr>
        {HEADERS.map((key) => (
          <th key={key} className={`${cell} font-medium`}>
            {t(key)}
          </th>
        ))}
        <th className={cell}>
          <span className="sr-only">{t('users.actions')}</span>
        </th>
      </tr>
    </thead>
  );
}

function UsersTable({ users, onOpen }: { users: UserSummary[]; onOpen(dialog: Dialog): void }) {
  return (
    <table className="w-full text-left text-sm">
      <TableHead />
      <tbody>
        {users.map((user) => (
          <UserRow key={user.id} user={user} onOpen={onOpen} />
        ))}
      </tbody>
    </table>
  );
}

function OpenDialog({ dialog, onClose }: { dialog: Dialog; onClose(): void }) {
  const { data } = useUsersSettings();
  if (!dialog) return null;
  if (dialog.kind === 'add') return <AddUserDialog onClose={onClose} />;
  if (dialog.kind === 'delete') return <DeleteUserDialog user={dialog.user} onClose={onClose} />;
  return (
    <EditUserDialog
      user={dialog.user}
      biometricAvailable={data?.biometricAvailable ?? false}
      onClose={onClose}
    />
  );
}

function Header({ onAdd }: { onAdd(): void }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between gap-4">
      <div>
        <Link to="/settings" className="text-sm text-amber-600 hover:underline">
          {t('nav.settings')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('users.title')}</h1>
      </div>
      <Button variant="primary" onClick={onAdd} testId="add-user">
        {t('users.addUser')}
      </Button>
    </header>
  );
}

/**
 * Users screen (SPEC 8.1 #12, Admin): every account with its role and status,
 * add, edit, limit what they see, and delete.
 */
export function UsersPage() {
  const { data = [] } = useUsers();
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <section className="mx-auto w-full max-w-4xl space-y-4 p-6" data-testid="users-page">
      <Header onAdd={() => setDialog({ kind: 'add' })} />
      <UsersTable users={data} onOpen={setDialog} />
      <OpenDialog dialog={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}
