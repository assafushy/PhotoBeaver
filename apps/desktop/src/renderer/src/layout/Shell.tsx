import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { usePlugins } from '../plugins/use-plugins';

const NAV_ITEMS = [
  { to: '/library', key: 'nav.library' },
  { to: '/map', key: 'nav.map' },
  { to: '/people', key: 'nav.people', needsFaces: true },
  { to: '/duplicates', key: 'nav.duplicates', needsMerge: true },
  { to: '/sources', key: 'nav.sources' },
  { to: '/plugins', key: 'nav.plugins' },
  { to: '/activity', key: 'nav.activity' },
  { to: '/settings', key: 'nav.settings' },
] as const;

function navClass({ isActive }: { isActive: boolean }): string {
  const base =
    'block rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-amber-500';
  const state = isActive
    ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
    : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800';
  return `${base} ${state}`;
}

function useNavFlags(): { needsMerge: boolean; needsFaces: boolean } {
  const { data } = usePlugins();
  const enabled = (data ?? []).filter((p) => p.enabled);
  return {
    needsMerge: enabled.some((p) => p.permissions?.assets === 'merge'),
    needsFaces: enabled.some((p) => p.produces.includes('faces')),
  };
}

function NavList() {
  const { t } = useTranslation();
  const flags = useNavFlags();
  const items = NAV_ITEMS.filter(
    (item) =>
      !('needsMerge' in item || 'needsFaces' in item) ||
      ('needsMerge' in item ? flags.needsMerge : flags.needsFaces),
  );
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

function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-6 px-3 text-lg font-semibold">{t('app.name')}</div>
      <NavList />
    </aside>
  );
}

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
