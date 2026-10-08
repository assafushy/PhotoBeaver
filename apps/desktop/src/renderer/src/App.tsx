import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ActivityPage } from './activity/ActivityPage';
import { AlbumsPage } from './albums/AlbumsPage';
import { RequirePermission } from './auth/RequirePermission';
import { SignInScreen } from './auth/SignInScreen';
import { DuplicatesPage } from './duplicates/DuplicatesPage';
import { Shell } from './layout/Shell';
import { LibraryPage } from './library/LibraryPage';
import { MapPage } from './map/MapPage';
import { PeoplePage } from './people/PeoplePage';
import { PersonPage } from './people/PersonPage';
import { PluginsPage } from './plugins/PluginsPage';
import { useSession, useSessionSync } from './session/use-session';
import { SettingsPage } from './settings/SettingsPage';
import { SourcesPage } from './sources/SourcesPage';
import { UsersPage } from './users/UsersPage';
import { ViewerOverlay } from './viewer/ViewerOverlay';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const GUARDED_ROUTES = [
  { path: 'plugins', permission: 'plugins.manage', Page: PluginsPage },
  { path: 'activity', permission: 'library.admin', Page: ActivityPage },
  { path: 'settings/users', permission: 'users.manage', Page: UsersPage },
] as const;

function guardedRoutes() {
  return GUARDED_ROUTES.map(({ path, permission, Page }) => (
    <Route
      key={path}
      path={path}
      element={
        <RequirePermission permission={permission}>
          <Page />
        </RequirePermission>
      }
    />
  ));
}

function shellRoutes() {
  return (
    <>
      <Route index element={<Navigate to="/library" replace />} />
      <Route path="library" element={<LibraryPage />}>
        <Route path="asset/:assetId" element={<ViewerOverlay />} />
      </Route>
      <Route path="map" element={<MapPage />} />
      <Route path="albums" element={<AlbumsPage />} />
      <Route path="duplicates" element={<DuplicatesPage />} />
      <Route path="people" element={<PeoplePage />} />
      <Route path="people/:personId" element={<PersonPage />} />
      <Route path="sources" element={<SourcesPage />} />
      <Route path="settings" element={<SettingsPage />} />
      {guardedRoutes()}
      <Route path="*" element={<Navigate to="/library" replace />} />
    </>
  );
}

function SessionGate() {
  useSessionSync();
  const { data } = useSession();
  if (!data) return null;
  if (data.state === 'locked') return <SignInScreen />;
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>{shellRoutes()}</Route>
      </Routes>
    </HashRouter>
  );
}

/**
 * The renderer root: the sign-in screen while the app is locked, otherwise
 * the app shell and its screens.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate />
    </QueryClientProvider>
  );
}
