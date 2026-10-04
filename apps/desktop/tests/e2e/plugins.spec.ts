import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { writeImageSet } from '../fixtures/generate';
import { launchApp, libraryCount, removeDir, tempDir, type RendererGlobals, closeApp } from './app';
import { addSampleItem, pbPlugin, scaffoldConnector, startDev } from './plugin-project';

const LOCAL = 'com.photobeaver.connector-local';
const SAMPLE = 'com.example.e2e-sample';
const pb = (page: Page) => page.evaluate(() => (globalThis as RendererGlobals).pb.plugins.list());

test.describe.configure({ mode: 'serial' });

const cleanup: string[] = [];
test.afterAll(() => cleanup.forEach(removeDir));
const temp = (prefix: string) => {
  const dir = tempDir(prefix);
  cleanup.push(dir);
  return dir;
};

test('installs the default local connector on first run and lists it', async () => {
  const userData = temp('pb-e2e-plugins-');
  const { app, page } = await launchApp(userData);
  await page.getByRole('link', { name: 'Plugins' }).click();
  const card = page.locator(`[data-plugin-id="${LOCAL}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('plugin-status')).toHaveText('Enabled');
  await expect(card).toContainText('Default');
  expect(
    existsSync(path.join(userData, 'plugins', LOCAL, '0.1.0', 'photobeaver-plugin.json')),
  ).toBe(true);
  await closeApp(app);
});

test('keeps the UI working when the plugin host is killed, and the sync job retries', async () => {
  test.setTimeout(120_000);
  const userData = temp('pb-e2e-hostkill-');
  const photos = temp('pb-e2e-hostkill-photos-');
  await writeImageSet(photos, 1200, 400);
  const { app, page } = await launchApp(userData, { PB_SYNC_BATCH_DELAY_MS: '1500' });
  await page.evaluate(
    (root) =>
      (globalThis as RendererGlobals).pb.sources.add({
        pluginId: 'com.photobeaver.connector-local',
        config: { root },
      }),
    photos,
  );
  await expect(page.getByTestId('library-tile').first()).toBeVisible({ timeout: 20_000 });
  const pid = (await pb(page)).find((p) => p.id === LOCAL)!.pid!;
  process.kill(pid, 'SIGKILL');
  await page.getByRole('link', { name: 'Sources' }).click();
  await expect(page.getByTestId('source-card')).toBeVisible();
  await page.getByRole('link', { name: 'Library' }).click();
  await expect.poll(() => libraryCount(page), { timeout: 90_000 }).toBe(1200);
  expect((await pb(page)).find((p) => p.id === LOCAL)!.restarts).toBeGreaterThanOrEqual(1);
  await closeApp(app);
});

test('disabling a connector hides it from Add source and flags its sources', async () => {
  const userData = temp('pb-e2e-disable-');
  const photos = temp('pb-e2e-disable-photos-');
  await writeImageSet(photos, 3);
  const { app, page } = await launchApp(userData);
  await page.evaluate(
    (root) =>
      (globalThis as RendererGlobals).pb.sources.add({
        pluginId: 'com.photobeaver.connector-local',
        config: { root },
      }),
    photos,
  );
  await page.getByRole('link', { name: 'Plugins' }).click();
  await page
    .locator(`[data-plugin-id="${LOCAL}"]`)
    .getByRole('button', { name: 'Disable' })
    .click();
  await expect(page.locator(`[data-plugin-id="${LOCAL}"]`).getByTestId('plugin-status')).toHaveText(
    'Disabled',
  );
  await page.getByRole('link', { name: 'Sources' }).click();
  await expect(page.getByTestId('source-card')).toContainText('not installed or is disabled');
  await page.getByRole('link', { name: 'Plugins' }).click();
  await page.locator(`[data-plugin-id="${LOCAL}"]`).getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator(`[data-plugin-id="${LOCAL}"]`).getByTestId('plugin-status')).toHaveText(
    'Enabled',
  );
  await closeApp(app);
});

test('develops a scaffolded plugin with hot reload, packs it and installs it from file on a clean profile', async () => {
  test.setTimeout(180_000);
  const project = path.join(temp('pb-e2e-project-'), 'sample');
  const socket =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\pb-e2e-${process.pid}`
      : path.join(tmpdir(), `pb-e2e-${process.pid}.sock`);
  scaffoldConnector(project, SAMPLE);
  pbPlugin(['build', '--dir', project]);

  const dev = await launchApp(temp('pb-e2e-dev-'), { PB_DEV_SOCKET: socket });
  await dev.page.getByRole('link', { name: 'Plugins' }).click();
  await dev.page.getByRole('tab', { name: 'Developer' }).click();
  await dev.page.getByTestId('developer-mode').check();
  const watcher = startDev(project, socket);
  try {
    await expect(dev.page.locator(`[data-plugin-id="${SAMPLE}"]`)).toBeVisible({ timeout: 30_000 });
    await dev.page.evaluate(
      (id) => (globalThis as RendererGlobals).pb.sources.add({ pluginId: id, config: {} }),
      SAMPLE,
    );
    await dev.page.getByRole('link', { name: 'Library' }).click();
    await expect.poll(() => libraryCount(dev.page), { timeout: 30_000 }).toBe(2);
    const before = (await pb(dev.page)).find((p) => p.id === SAMPLE)!;
    addSampleItem(project);
    await expect
      .poll(async () => (await pb(dev.page)).find((p) => p.id === SAMPLE)?.pid, { timeout: 30_000 })
      .not.toBe(before.pid);
    const source = (
      await dev.page.evaluate(() => (globalThis as RendererGlobals).pb.sources.list())
    ).find((s) => s.pluginId === SAMPLE)!;
    await dev.page.evaluate(
      (id) => (globalThis as RendererGlobals).pb.sources.syncNow(id),
      source.id,
    );
    await expect.poll(() => libraryCount(dev.page), { timeout: 30_000 }).toBe(3);
  } finally {
    watcher.kill();
    await closeApp(dev.app);
  }

  pbPlugin(['pack', '--dir', project]);
  const packageFile = path.join(project, `${SAMPLE}-0.1.0.pbplugin`);
  expect(existsSync(packageFile)).toBe(true);

  const clean = await launchApp(temp('pb-e2e-clean-'));
  await clean.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file],
    })) as typeof dialog.showOpenDialog;
  }, packageFile);
  await clean.page.getByRole('link', { name: 'Plugins' }).click();
  await clean.page.getByRole('button', { name: 'Install from file' }).click();
  await expect(clean.page.getByRole('dialog')).toContainText('nobody has reviewed it');
  await expect(clean.page.getByRole('dialog').getByTestId('permission-list')).toContainText(
    'No network access',
  );
  await clean.page.getByRole('dialog').getByRole('button', { name: 'Install' }).click();
  const card = clean.page.locator(`[data-plugin-id="${SAMPLE}"]`);
  await expect(card.getByTestId('plugin-status')).toHaveText('Enabled');
  await expect(card).toContainText('From file');
  await clean.page.evaluate(
    (id) => (globalThis as RendererGlobals).pb.sources.add({ pluginId: id, config: {} }),
    SAMPLE,
  );
  await clean.page.getByRole('link', { name: 'Library' }).click();
  await expect.poll(() => libraryCount(clean.page), { timeout: 30_000 }).toBe(3);
  await closeApp(clean.app);
});
