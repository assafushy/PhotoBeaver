import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, removeDir, tempDir, type RendererGlobals, closeApp } from './app';

let userDataDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  userDataDir = tempDir('pb-e2e-');
  ({ app, page } = await launchApp(userDataDir));
});

test.afterEach(async () => {
  await closeApp(app);
  removeDir(userDataDir);
});

test('launches, creates the library database and shows the empty library', async () => {
  await expect(page.getByTestId('library-empty')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No photos yet' })).toBeVisible();
  expect(existsSync(path.join(userDataDir, 'library', 'photobeaver.db'))).toBe(true);
});

test('exposes only the typed bridge to the renderer', async () => {
  const globals = await page.evaluate(() => {
    const scope = globalThis as RendererGlobals;
    return {
      hasPb: typeof scope.pb?.library.query === 'function',
      hasRequire: typeof scope.require !== 'undefined',
    };
  });
  expect(globals).toEqual({ hasPb: true, hasRequire: false });
  const session = await page.evaluate(() => (globalThis as RendererGlobals).pb.session.current());
  expect(session.role).toBe('admin');
});

test('navigates between screens from the sidebar', async () => {
  await page.getByRole('link', { name: 'Plugins' }).click();
  await expect(page.getByRole('heading', { name: 'Plugins' })).toBeVisible();
});

test('answers pb-media requests with validation errors or not found, never file contents', async () => {
  const urls = [
    'pb-media://thumb/..%2F..%2Fetc%2Fpasswd/256',
    'pb-media://thumb/01K6P4J2Z9X8W7V6T5S4R3Q2P1/512',
    'pb-media://thumb/01K6P4J2Z9X8W7V6T5S4R3Q2P1/256',
    'pb-media://original/01K6P4J2Z9X8W7V6T5S4R3Q2P1',
  ];
  const statuses = await app.evaluate(
    ({ net }, list) => Promise.all(list.map((u) => net.fetch(u).then((r) => r.status))),
    urls,
  );
  expect(statuses).toEqual([400, 400, 404, 404]);
});

test('blocks renderer fetches to pb-media through the content security policy', async () => {
  const blocked = await page.evaluate(() =>
    fetch('pb-media://original/01K6P4J2Z9X8W7V6T5S4R3Q2P1').then(
      () => false,
      () => true,
    ),
  );
  expect(blocked).toBe(true);
});
