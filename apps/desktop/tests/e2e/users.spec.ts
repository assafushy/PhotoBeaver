import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { writeEnrichmentSet } from '../fixtures/enrichment-set';
import { writeImageSet } from '../fixtures/generate';
import { closeApp, launchApp, libraryCount, removeDir, tempDir, type RendererGlobals } from './app';

test.describe.configure({ mode: 'serial' });

const LOCAL = 'com.photobeaver.connector-local';
const ADMIN_PASSWORD = 'admin password 1';
const KID_PIN = '2468';
const ED_PASSWORD = 'editor password';

let main: string;
let family: string;
let userData: string;
const ids: {
  familyAsset?: string;
  outsideAsset?: string;
  adminId?: string;
  kidId?: string;
  edId?: string;
} = {};

function call<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([path, params]) => {
      const parts = (path as string).split('.');
      let target: unknown = (globalThis as RendererGlobals).pb;
      for (const part of parts.slice(0, -1)) target = (target as Record<string, unknown>)[part];
      const method = (target as Record<string, (...a: unknown[]) => unknown>)[parts.at(-1)!]!;
      return method.apply(target, params as unknown[]) as Promise<T>;
    },
    [fn, args] as const,
  ) as Promise<T>;
}

async function callError(page: Page, fn: string, ...args: unknown[]): Promise<string> {
  return page.evaluate(
    ([path, params]) => {
      const parts = (path as string).split('.');
      let target: unknown = (globalThis as RendererGlobals).pb;
      for (const part of parts.slice(0, -1)) target = (target as Record<string, unknown>)[part];
      const method = (target as Record<string, (...a: unknown[]) => Promise<unknown>>)[
        parts.at(-1)!
      ]!;
      return method.apply(target, params as unknown[]).then(
        () => 'ok',
        (error: { code?: string; message: string }) => error.code ?? error.message,
      );
    },
    [fn, args] as const,
  );
}

async function thumbLoads(page: Page, assetId: string): Promise<boolean> {
  return page.evaluate(
    (id) =>
      new Promise<boolean>((resolve) => {
        const img = new (
          globalThis as unknown as {
            Image: new () => { onload: () => void; onerror: () => void; src: string };
          }
        ).Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = `pb-media://thumb/${id}/256?probe=${Date.now()}`;
      }),
    assetId,
  );
}

async function signIn(page: Page, userId: string, secret: string): Promise<void> {
  await expect(page.getByTestId('signin-screen')).toBeVisible();
  await page.locator(`[data-testid="signin-user"][data-user-id="${userId}"]`).click();
  await page.getByTestId('signin-secret').fill(secret);
  await page.getByTestId('signin-submit').click();
  await expect(page.getByTestId('signin-screen')).toBeHidden();
}

async function lock(page: Page): Promise<void> {
  await call(page, 'auth.lock');
  await expect(page.getByTestId('signin-screen')).toBeVisible();
}

test.beforeAll(async () => {
  main = tempDir('pb-e2e-users-main-');
  family = tempDir('pb-e2e-users-family-');
  userData = tempDir('pb-e2e-users-data-');
  await writeEnrichmentSet(main);
  await writeImageSet(family, 3);
});

test.afterAll(() => [main, family, userData].forEach(removeDir));

test('an admin turns on multiple users and creates a scoped viewer and an editor', async () => {
  test.setTimeout(150_000);
  const { app, page } = await launchApp(userData);
  await call(page, 'sources.add', { pluginId: LOCAL, config: { root: main } });
  await call(page, 'sources.add', { pluginId: LOCAL, config: { root: family } });
  await expect.poll(() => libraryCount(page), { timeout: 60_000 }).toBe(11);
  const familyPage = await call<{ items: { id: string }[] }>(page, 'library.query', {
    limit: 100,
    filter: { text: 'set' },
  });
  ids.familyAsset = familyPage.items[0]!.id;
  const paris = await call<{ items: { id: string }[] }>(page, 'library.query', {
    limit: 100,
    filter: { text: 'paris' },
  });
  ids.outsideAsset = paris.items[0]!.id;
  const album = await call<{ id: string }>(page, 'albums.create', 'Family');
  await call(
    page,
    'albums.addAssets',
    album.id,
    familyPage.items.map((i) => i.id),
  );
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByTestId('multiuser-toggle').click();
  await page.getByTestId('admin-password').fill(ADMIN_PASSWORD);
  await page.getByTestId('admin-password-confirm').fill(ADMIN_PASSWORD);
  await page.getByTestId('enable-multiuser').click();
  await expect(page.getByTestId('recovery-key-display')).toHaveText(/[A-Z2-9]{4}-/);
  await page.getByTestId('recovery-saved').click();
  const admin = await call<{ user: { id: string } }>(page, 'session.current');
  ids.adminId = admin.user.id;
  const kid = await call<{ id: string }>(page, 'users.create', {
    displayName: 'Kid',
    role: 'viewer',
    secret: KID_PIN,
    secretKind: 'pin',
  });
  ids.kidId = kid.id;
  await call(page, 'users.setScopes', kid.id, { sourceIds: [], albumIds: [album.id] });
  const ed = await call<{ id: string }>(page, 'users.create', {
    displayName: 'Ed',
    role: 'editor',
    secret: ED_PASSWORD,
    secretKind: 'password',
  });
  ids.edId = ed.id;
  await closeApp(app);
});

test('a viewer scoped to one album sees, searches and loads nothing else', async () => {
  const { app, page } = await launchApp(userData);
  await signIn(page, ids.kidId!, KID_PIN);
  await expect.poll(() => libraryCount(page), { timeout: 15_000 }).toBe(3);
  await page.getByTestId('search-box').fill('paris');
  await expect.poll(() => libraryCount(page)).toBe(0);
  expect(await thumbLoads(page, ids.outsideAsset!)).toBe(false);
  expect(await callError(page, 'assets.get', ids.outsideAsset!)).not.toBe('ok');
  expect(await callError(page, 'sources.add', { pluginId: LOCAL, config: { root: main } })).toMatch(
    /Missing permission/,
  );
  await expect(page.getByRole('link', { name: 'Sources' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Plugins' })).toHaveCount(0);
  await closeApp(app);
});

test('an editor can tag and merge but not add sources or plugins', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp(userData);
  await signIn(page, ids.edId!, ED_PASSWORD);
  await call(page, 'edits.addTag', [ids.outsideAsset!], 'Eiffel visit');
  await page.getByTestId('search-box').fill('Eiffel');
  await expect.poll(() => libraryCount(page), { timeout: 10_000 }).toBe(1);
  await expect
    .poll(async () => (await call<unknown[]>(page, 'duplicates.list')).length, { timeout: 60_000 })
    .toBeGreaterThan(0);
  const [group] = await call<{ id: string; assets: { id: string }[] }[]>(page, 'duplicates.list');
  expect(await callError(page, 'duplicates.merge', group!.id, group!.assets[0]!.id)).toBe('ok');
  expect(await callError(page, 'sources.add', { pluginId: LOCAL, config: { root: main } })).toMatch(
    /Missing permission/,
  );
  expect(await callError(page, 'plugins.setEnabled', LOCAL, false)).toMatch(/Missing permission/);
  await expect(page.getByRole('link', { name: 'Sources' })).toHaveCount(0);
  await closeApp(app);
});

test('the last admin cannot be demoted, and sync keeps running while locked', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp(userData);
  await signIn(page, ids.adminId!, ADMIN_PASSWORD);
  expect(await callError(page, 'users.update', { id: ids.adminId!, role: 'editor' })).toMatch(
    /at least one Admin|INTERNAL/,
  );
  const before = await call<{ total: number }>(page, 'library.query', { limit: 1 });
  await lock(page);
  writeFileSync(
    path.join(family, 'added-while-locked.png'),
    await import('sharp').then((m) =>
      m
        .default({ create: { width: 40, height: 30, channels: 3, background: '#123456' } })
        .png()
        .toBuffer(),
    ),
  );
  await page.waitForTimeout(8_000);
  await signIn(page, ids.adminId!, ADMIN_PASSWORD);
  await expect
    .poll(async () => (await call<{ total: number }>(page, 'library.query', { limit: 1 })).total, {
      timeout: 30_000,
    })
    .toBe(before.total + 1);
  await closeApp(app);
});
