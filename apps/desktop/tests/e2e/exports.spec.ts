import { expect, test, type Page } from '@playwright/test';
import { writeFacebookExport, writeInstagramExport, writeTakeoutExport } from '../fixtures/exports';
import { launchApp, libraryCount, removeDir, tempDir, type RendererGlobals, closeApp } from './app';

test.describe.configure({ mode: 'serial' });

const roots: Record<string, string> = {};
let userData: string;

test.beforeAll(async () => {
  roots.facebook = tempDir('pb-e2e-fb-');
  roots.instagram = tempDir('pb-e2e-ig-');
  roots.takeout = tempDir('pb-e2e-takeout-');
  userData = tempDir('pb-e2e-exports-');
  await writeFacebookExport(roots.facebook);
  await writeInstagramExport(roots.instagram);
  await writeTakeoutExport(roots.takeout);
});

test.afterAll(() => [...Object.values(roots), userData].forEach(removeDir));

async function addSource(
  page: Page,
  pluginId: string,
  config: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([id, cfg]) =>
      (globalThis as RendererGlobals).pb.sources.add({
        pluginId: id as string,
        config: cfg as Record<string, unknown>,
      }),
    [pluginId, config] as const,
  );
}

async function searchCount(page: Page, text: string): Promise<number> {
  await page.getByTestId('search-box').fill(text);
  await page.waitForTimeout(400);
  return libraryCount(page);
}

test('imports Facebook, Instagram and Google Takeout exports read in place', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp(userData);
  await addSource(page, 'com.photobeaver.connector-facebook-export', { root: roots.facebook });
  await addSource(page, 'com.photobeaver.connector-instagram-export', { root: roots.instagram });
  await addSource(page, 'com.photobeaver.connector-google-photos', {
    mode: 'takeout',
    root: roots.takeout,
  });
  await expect.poll(() => libraryCount(page), { timeout: 60_000 }).toBe(7);
  await expect.poll(() => searchCount(page, 'Café'), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => searchCount(page, 'Señor'), { timeout: 30_000 }).toBe(1);
  const points = await page.evaluate(() =>
    (globalThis as RendererGlobals).pb.library.geoPoints({}),
  );
  expect(points.points).toHaveLength(2);
  await closeApp(app);
});

test('shows the Facebook photo with its export date and place in the viewer', async () => {
  const { app, page } = await launchApp(userData);
  await expect.poll(() => searchCount(page, 'Café'), { timeout: 30_000 }).toBe(1);
  await page.getByTestId('library-tile').first().click();
  await expect(page.getByTestId('viewer-info')).toContainText('2023');
  await expect(page.getByTestId('viewer-place')).toContainText('Paris', { timeout: 30_000 });
  await closeApp(app);
});
