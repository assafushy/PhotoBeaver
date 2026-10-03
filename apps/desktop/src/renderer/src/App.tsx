import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './layout/Shell';
import { LibraryPage } from './routes/LibraryPage';
import { PlaceholderPage } from './routes/PlaceholderPage';

const queryClient = new QueryClient();

const PLACEHOLDER_ROUTES = [
  { path: 'sources', titleKey: 'nav.sources' },
  { path: 'plugins', titleKey: 'nav.plugins' },
  { path: 'activity', titleKey: 'nav.activity' },
  { path: 'settings', titleKey: 'nav.settings' },
] as const;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Navigate to="/library" replace />} />
            <Route path="library" element={<LibraryPage />} />
            {PLACEHOLDER_ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={<PlaceholderPage titleKey={r.titleKey} />}
              />
            ))}
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
