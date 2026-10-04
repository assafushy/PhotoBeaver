import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { buttonStyles } from '../components/Modal';

/**
 * Shown while a source setup runs. Connectors that sign in tell the user to
 * finish in the browser; the setup can be cancelled.
 */
export function SetupWaiting({ usesOAuth, onCancel }: { usesOAuth: boolean; onCancel(): void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-900/30"
      data-testid="setup-waiting"
    >
      <span>{t(usesOAuth ? 'sources.waitingForSignIn' : 'sources.settingUp')}</span>
      <button type="button" className={buttonStyles.secondary} onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

const SETTINGS_HINT = /plugin's settings/i;

/**
 * A setup error. Errors that ask for plugin settings (such as a missing client
 * ID) link to the Plugins screen.
 */
export function SetupError({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <p role="alert" className="text-sm text-red-600">
      {error.message}
      {SETTINGS_HINT.test(error.message) && (
        <Link to="/plugins" className="ml-2 underline">
          {t('sources.openPluginSettings')}
        </Link>
      )}
    </p>
  );
}
