import { rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { writeImageSet } from '../fixtures/generate';
import { launchApp, libraryCount, tempDir, type RendererGlobals } from './app';

const COUNT = 1500;
const LOCAL = 'com.photobeaver.connector-local';

function instanceStats(userDataDir: string): { total: number; uniq: number; live: number } {
  const db = new Database(path.join(userDataDir, 'library', 'photobeaver.db'), { readonly: true });
  const row = db
    .prepare(
      'SELECT COUNT(*) AS total, COUNT(DISTINCT external_id) AS uniq, SUM(deleted_at IS NULL) AS live FROM instances',
    )
    .get() as { total: number; uniq: number; live: number };
  db.close();
  return row;
}

test.describe.configure({ mode: 'serial' });

let root: string;
let userDataDir: string;
let files: string[];

test.beforeAll(async () => {
  root = tempDir('pb-e2e-photos-');
  userDataDir = tempDir('pb-e2e-sync-');
  files = await writeImageSet(root, COUNT, 300);
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(userDataDir, { recursive: true, force: true });
});

test('fills the grid progressively and resumes after the app is killed mid-sync', async () => {
  test.setTimeout(120_000);
  const first = await launchApp(userDataDir, { PB_SYNC_BATCH_DELAY_MS: '1500' });
  await first.page.evaluate(
    ([pluginId, folder]) =>
      (globalThis as RendererGlobals).pb.sources.add({
        pluginId: pluginId!,
        config: { root: folder },
      }),
    [LOCAL, root],
  );
  await expect(first.page.getByTestId('library-tile').first()).toBeVisible({ timeout: 20_000 });
  const partial = await libraryCount(first.page);
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(COUNT);
  first.app.process().kill('SIGKILL');

  const second = await launchApp(userDataDir);
  await expect.poll(() => libraryCount(second.page), { timeout: 60_000 }).toBe(COUNT);
  await second.app.close();
  expect(instanceStats(userDataDir)).toEqual({ total: COUNT, uniq: COUNT, live: COUNT });
});

test('removes a deleted file from the grid after Sync now', async () => {
  const { app, page } = await launchApp(userDataDir);
  await expect.poll(() => libraryCount(page)).toBe(COUNT);
  unlinkSync(path.join(root, files[10]!));
  await page.getByRole('link', { name: 'Sources' }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('source-count')).toHaveText(new RegExp(`^${COUNT - 1} items$`), {
    timeout: 30_000,
  });
  await page.getByRole('link', { name: 'Library' }).click();
  await expect.poll(() => libraryCount(page)).toBe(COUNT - 1);
  await app.close();
});

test('opens the viewer and steps through photos with the keyboard', async () => {
  const { app, page } = await launchApp(userDataDir);
  await page.getByTestId('library-tile').first().click();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-info')).toContainText('Locations');
  const firstUrl = page.url();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.url()).not.toBe(firstUrl);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.url()).toBe(firstUrl);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('viewer')).toBeHidden();
  await app.close();
});
