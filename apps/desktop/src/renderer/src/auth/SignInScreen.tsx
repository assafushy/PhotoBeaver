import type { PickerUser } from '@photobeaver/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar';
import { RecoveryForm } from './RecoveryForm';
import { SecretForm } from './SecretForm';

interface PickerProps {
  users: PickerUser[];
  selectedId: string | null;
  onSelect(id: string): void;
}

function UserPicker({ users, selectedId, onSelect }: PickerProps) {
  return (
    <ul className="flex flex-wrap justify-center gap-6">
      {users.map((user) => (
        <li key={user.id}>
          <button
            type="button"
            aria-pressed={user.id === selectedId}
            className={`flex w-28 flex-col items-center gap-2 rounded-lg p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${user.id === selectedId ? 'ring-2 ring-amber-500' : ''}`}
            onClick={() => onSelect(user.id)}
            data-testid="signin-user"
            data-user-id={user.id}
          >
            <Avatar name={user.displayName} />
            <span className="truncate text-sm font-medium">{user.displayName}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ForgotLink({ onClick }: { onClick(): void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="text-sm text-amber-600 hover:underline"
      onClick={onClick}
      data-testid="signin-forgot"
    >
      {t('auth.forgot')}
    </button>
  );
}

function usePicker() {
  const { data: users = [] } = useQuery({
    queryKey: ['auth', 'users'],
    queryFn: () => window.pb.auth.users(),
  });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const selectedId = chosenId ?? (users.length === 1 ? users[0]!.id : null);
  const selected = users.find((user) => user.id === selectedId);
  return { users, selectedId, selected, choose: setChosenId };
}

function SignInPanel({ onForgot }: { onForgot(): void }) {
  const { users, selectedId, selected, choose } = usePicker();
  return (
    <>
      <UserPicker users={users} selectedId={selectedId} onSelect={choose} />
      {selected && <SecretForm key={selected.id} user={selected} />}
      <ForgotLink onClick={onForgot} />
    </>
  );
}

/**
 * The full-window sign-in screen shown while the app is locked (multiple users
 * only, SPEC 8.1 #13): pick a user, then their password, PIN or Touch ID.
 */
export function SignInScreen() {
  const { t } = useTranslation();
  const [recovering, setRecovering] = useState(false);
  return (
    <main
      className="flex h-screen flex-col items-center justify-center gap-8 bg-white p-8 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="signin-screen"
    >
      <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
      {recovering ? (
        <RecoveryForm onBack={() => setRecovering(false)} />
      ) : (
        <SignInPanel onForgot={() => setRecovering(true)} />
      )}
    </main>
  );
}
