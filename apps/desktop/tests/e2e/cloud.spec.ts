import { expect, test, type Page } from '@playwright/test';
import { launchApp, removeDir, tempDir, type RendererGlobals } from './app';

const DROPBOX = 'com.photobeaver.connector-dropbox';

let userData: string;

test.beforeAll(() => {
  userData = tempDir('pb-e2e-cloud-');
});

test.afterAll(() => removeDir(userData));

async function startAddingDropbox(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Sources' }).click();
  await page.getByRole('button', { name: 'Add source' }).click();
  await page.getByRole('button', { name: /^Dropbox/ }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

async function sourceCount(page: Page): Promise<number> {
  return page.evaluate(
    async () => (await (globalThis as RendererGlobals).pb.sources.list()).length,
  );
}

test('asks for the app key, then waits for the browser sign-in and can be cancelled', async () => {
  const { app, page } = await launchApp(userData, { PB_E2E_NO_BROWSER: '1' });
  await startAddingDropbox(page);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText("plugin's settings");
  await expect(alert.getByRole('link', { name: 'Open plugin settings' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const plugins = await (globalThis as RendererGlobals).pb.plugins.list();
        return plugins.find((plugin) => plugin.id === id)?.status;
      }, DROPBOX),
    )
    .toBe('ok');
  await page.evaluate(
    (id) => (globalThis as RendererGlobals).pb.plugins.setSettings(id, { clientId: 'test-key' }),
    DROPBOX,
  );
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const waiting = page.getByTestId('setup-waiting');
  await expect(waiting).toContainText('Finish signing in in your browser');
  await waiting.getByRole('button', { name: 'Cancel' }).click();
  await expect(waiting).toBeHidden();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await sourceCount(page)).toBe(0);
  await app.close();
});
