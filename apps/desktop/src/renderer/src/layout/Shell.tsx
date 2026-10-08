import type { Permission, SessionState } from '@photobeaver/shared';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { buttonStyles } from '../components/Modal';
import { useSession } from '../session/use-session';
import { useCapabilities } from './use-capabilities';

interface NavItem {
  to: string;
  key: string;
  permission?: Permission;
  capability?: 'faces' | 'merge';
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/library', key: 'nav.library' },
  { to: '/map', key: 'nav.map' },
  { to: '/albums', key: 'nav.albums' },
  { to: '/people', key: 'nav.people', capability: 'faces' },
  { to: '/duplicates', key: 'nav.duplicates', capability: 'merge' },
  { to: '/sources', key: 'nav.sources', permission: 'sources.manage' },
  { to: '/plugins', key: 'nav.plugins', permission: 'plugins.manage' },
  { to: '/activity', key: 'nav.activity', permission: 'library.admin' },
  { to: '/settings', key: 'nav.settings' },
];

function navClass({ isActive }: { isActive: boolean }): string {
  const base =
    'block rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-amber-500';
  const state = isActive
    ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
    : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800';
  return `${base} ${state}`;
}

function useVisibleItems(): NavItem[] {
  const { data } = useSession();
  const capabilities = useCapabilities();
  const permissions = data?.user?.permissions ?? [];
  return NAV_ITEMS.filter(
    (item) =>
      (!item.permission || permissions.includes(item.permission)) &&
      (!item.capability || capabilities[item.capability]),
  );
}

function NavList() {
  const { t } = useTranslation();
  const items = useVisibleItems();
  return (
    <nav aria-label={t('nav.label')}>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} className={navClass}>
              {t(item.key)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function CurrentUser({ session }: { session: SessionState }) {
  const { t } = useTranslation();
  if (!session.multiUser || !session.user) return null;
  return (
    <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-200 px-3 pt-3 dark:border-neutral-800">
      <span className="truncate text-sm font-medium" data-testid="current-user">
        {session.user.displayName}
      </span>
      <button
        type="button"
        className={buttonStyles.secondary}
        onClick={() => void window.pb.auth.lock()}
        data-testid="lock-button"
      >
        {t('auth.lock')}
      </button>
    </div>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  const { data } = useSession();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-6 px-3 text-lg font-semibold">{t('app.name')}</div>
      <NavList />
      {data && <CurrentUser session={data} />}
    </aside>
  );
}

/**
 * The app frame: sidebar navigation (filtered by the signed-in user's
 * permissions and the installed plugins) and the current screen.
 */
export function Shell() {
  return (
    <div className="flex h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
