import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DuplicatesPage } from './duplicates/DuplicatesPage';
import { Shell } from './layout/Shell';
import { LibraryPage } from './library/LibraryPage';
import { MapPage } from './map/MapPage';
import { PluginsPage } from './plugins/PluginsPage';
import { PlaceholderPage } from './routes/PlaceholderPage';
import { SourcesPage } from './sources/SourcesPage';
import { ViewerOverlay } from './viewer/ViewerOverlay';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

const PLACEHOLDER_ROUTES = [
  { path: 'activity', titleKey: 'nav.activity' },
  { path: 'settings', titleKey: 'nav.settings' },
] as const;

function shellRoutes() {
  return (
    <>
      <Route index element={<Navigate to="/library" replace />} />
      <Route path="library" element={<LibraryPage />}>
        <Route path="asset/:assetId" element={<ViewerOverlay />} />
      </Route>
      <Route path="map" element={<MapPage />} />
      <Route path="duplicates" element={<DuplicatesPage />} />
      <Route path="sources" element={<SourcesPage />} />
      <Route path="plugins" element={<PluginsPage />} />
      {PLACEHOLDER_ROUTES.map((r) => (
        <Route key={r.path} path={r.path} element={<PlaceholderPage titleKey={r.titleKey} />} />
      ))}
      <Route path="*" element={<Navigate to="/library" replace />} />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>{shellRoutes()}</Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
