import { useTranslation } from 'react-i18next';
import { useCan } from '../session/use-session';
import { MapSection } from './MapSection';
import { UsersSection } from './UsersSection';

/**
 * Settings screen (SPEC 8.1 #11). Each section shows only to users allowed to
 * change it.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const manageUsers = useCan('users.manage');
  const admin = useCan('library.admin');
  return (
    <section className="mx-auto w-full max-w-3xl space-y-4 p-6" data-testid="settings-page">
      <h1 className="text-2xl font-semibold">{t('nav.settings')}</h1>
      {manageUsers && <UsersSection />}
      {admin && <MapSection />}
      {!manageUsers && !admin && (
        <p className="text-sm text-neutral-500">{t('settings.nothing')}</p>
      )}
    </section>
  );
}
