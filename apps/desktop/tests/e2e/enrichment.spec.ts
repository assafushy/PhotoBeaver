import { expect, test, type Page } from '@playwright/test';
import { writeEnrichmentSet } from '../fixtures/enrichment-set';
import { launchApp, libraryCount, removeDir, tempDir, type RendererGlobals } from './app';

const LOCAL = 'com.photobeaver.connector-local';
const ASSETS = 8;
const ENRICH_TIMEOUT = 90_000;

test.describe.configure({ mode: 'serial' });

let root: string;
let userDataDir: string;

test.beforeAll(async () => {
  root = tempDir('pb-e2e-enrich-');
  userDataDir = tempDir('pb-e2e-enrich-data-');
  await writeEnrichmentSet(root);
});

test.afterAll(() => {
  removeDir(root);
  removeDir(userDataDir);
});

async function search(page: Page, text: string): Promise<void> {
  await page.getByTestId('search-box').fill(text);
}

async function addSource(page: Page): Promise<void> {
  await page.evaluate(
    ([pluginId, folder]) =>
      (globalThis as RendererGlobals).pb.sources.add({
        pluginId: pluginId!,
        config: { root: folder },
      }),
    [LOCAL, root],
  );
}

async function mapMarkerTotal(page: Page): Promise<number> {
  const clusters = await page
    .getByTestId('map-cluster')
    .evaluateAll((els) => els.reduce((sum, el) => sum + Number(el.getAttribute('data-count')), 0));
  return clusters + (await page.getByTestId('map-point').count());
}

test('enriches dates and places, merges copies and finds "Paris"', async () => {
  test.setTimeout(150_000);
  const { app, page } = await launchApp(userDataDir);
  await addSource(page);
  await expect.poll(() => libraryCount(page), { timeout: ENRICH_TIMEOUT }).toBe(ASSETS);
  await search(page, 'Paris');
  await expect.poll(() => libraryCount(page), { timeout: ENRICH_TIMEOUT }).toBe(2);
  await page.getByTestId('library-tile').first().click();
  const info = page.getByTestId('viewer-info');
  await expect(info).toContainText('from the camera');
  await expect(page.getByTestId('viewer-place')).toContainText('Paris');
  await expect(info).toContainText('Test Cam');
  await page.keyboard.press('Escape');
  await app.close();
});

test('shows a file copied into two folders as one item with two locations', async () => {
  const { app, page } = await launchApp(userDataDir);
  await search(page, 'same');
  await expect.poll(() => libraryCount(page)).toBe(1);
  await page.getByTestId('library-tile').first().click();
  await expect(page.getByTestId('viewer-info').locator('li', { hasText: 'same.jpg' })).toHaveCount(
    2,
  );
  await app.close();
});

test('lists the resized copy in Duplicates, merges it and undoes the merge', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp(userDataDir);
  await page.getByRole('link', { name: 'Duplicates' }).click();
  const group = page.getByTestId('duplicate-group');
  await expect(group).toHaveCount(1, { timeout: ENRICH_TIMEOUT });
  await expect(group.locator('img')).toHaveCount(2);
  await group.getByRole('button', { name: 'Merge' }).click();
  await expect(group).toHaveCount(0);
  const mine = page.getByTestId('recent-merge').filter({ hasText: 'Merged by you' });
  await mine.getByRole('button', { name: 'Undo' }).click();
  await expect(mine).toHaveCount(0);
  await page.getByRole('link', { name: 'Library' }).click();
  await expect.poll(() => libraryCount(page)).toBe(ASSETS);
  await app.close();
});

function collectRendererErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('crash', () => errors.push('renderer crashed'));
  return errors;
}

async function expectMapMarkers(page: Page, errors: string[]): Promise<void> {
  try {
    await expect(page.getByTestId('map-count')).toContainText('3 photos');
    await expect.poll(() => mapMarkerTotal(page), { timeout: 20_000 }).toBe(3);
  } catch (error) {
    throw new Error(`${String(error)}\nRenderer errors:\n${errors.join('\n')}`, {
      cause: error,
    });
  }
}

test('shows geotagged photos on the map', async () => {
  const { app, page } = await launchApp(userDataDir);
  const errors = collectRendererErrors(page);
  await page.getByRole('link', { name: 'Map' }).click();
  await expectMapMarkers(page, errors);
  expect(errors).toEqual([]);
  await app.close();
});
