import type { UsersSettings } from '@photobeaver/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ErrorText } from '../components/ErrorText';
import { SelectField } from '../components/Field';
import { errorMessage } from '../lib/error-message';
import { DisableMultiDialog } from './DisableMultiDialog';
import { EnableMultiDialog } from './EnableMultiDialog';
import { SettingsSection } from './SettingsSection';
import { USERS_SETTINGS_KEY, useUsersSettings } from './use-users-settings';

const AUTO_LOCK_CHOICES = [0, 5, 15, 30, 60];

function MultiUserToggle({ on, onToggle }: { on: boolean; onToggle(): void }) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-3 text-sm">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={onToggle}
        data-testid="multiuser-toggle"
      />
      <span>
        <span className="block font-medium">{t('settings.users.multiUser')}</span>
        <span className="text-neutral-500">{t('settings.users.multiUserHelp')}</span>
      </span>
    </label>
  );
}

function useAutoLock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number) => window.pb.users.setAutoLock(minutes),
    onSuccess: () => void client.invalidateQueries({ queryKey: USERS_SETTINGS_KEY }),
  });
}

function useAutoLockOptions(minutes: number) {
  const { t } = useTranslation();
  const choices = AUTO_LOCK_CHOICES.includes(minutes)
    ? AUTO_LOCK_CHOICES
    : [...AUTO_LOCK_CHOICES, minutes];
  return choices.map((choice) => ({
    value: String(choice),
    label:
      choice === 0
        ? t('settings.users.autoLockOff')
        : t('settings.users.minutes', { count: choice }),
  }));
}

function AutoLockSelect({ minutes }: { minutes: number }) {
  const { t } = useTranslation();
  const save = useAutoLock();
  return (
    <div className="max-w-56 space-y-1">
      <SelectField
        label={t('settings.users.autoLock')}
        value={String(minutes)}
        options={useAutoLockOptions(minutes)}
        onChange={(value) => save.mutate(Number(value))}
        testId="autolock-select"
      />
      {save.error && <ErrorText>{errorMessage(save.error)}</ErrorText>}
    </div>
  );
}

function MultiUserOptions({ settings }: { settings: UsersSettings }) {
  const { t } = useTranslation();
  return (
    <>
      <AutoLockSelect minutes={settings.autoLockMinutes} />
      <Link
        to="/settings/users"
        className="inline-block text-sm text-amber-600 hover:underline"
        data-testid="manage-users"
      >
        {t('settings.users.manage')}
      </Link>
    </>
  );
}

/**
 * Settings > Users (Admin): the multiple-users switch, auto-lock and a link to
 * the Users screen. Until multiple users is on, only the switch shows.
 */
export function UsersSection() {
  const { t } = useTranslation();
  const { data } = useUsersSettings();
  const [dialog, setDialog] = useState<'enable' | 'disable' | null>(null);
  const close = (open: boolean) => !open && setDialog(null);
  return (
    <SettingsSection title={t('settings.users.title')}>
      {data && (
        <MultiUserToggle
          on={data.multiUser}
          onToggle={() => setDialog(data.multiUser ? 'disable' : 'enable')}
        />
      )}
      {data?.multiUser && <MultiUserOptions settings={data} />}
      {dialog === 'enable' && <EnableMultiDialog open onOpenChange={close} />}
      {dialog === 'disable' && <DisableMultiDialog open onOpenChange={close} />}
    </SettingsSection>
  );
}
