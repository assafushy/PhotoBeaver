import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PbApi } from '@photobeaver/shared';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

type RendererGlobals = typeof globalThis & { pb?: PbApi; require?: unknown };

const MAIN_ENTRY = fileURLToPath(new URL('../../out/main/index.js', import.meta.url));

let userDataDir: string;
let app: ElectronApplication;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'pb-e2e-'));
  app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, PB_USER_DATA_DIR: userDataDir },
  });
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('launches, creates the library database and shows the empty library', async () => {
  const page = await app.firstWindow();
  await expect(page.getByTestId('library-empty')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No photos yet' })).toBeVisible();
  expect(existsSync(path.join(userDataDir, 'library', 'photobeaver.db'))).toBe(true);
});

test('exposes only the typed bridge to the renderer', async () => {
  const page = await app.firstWindow();
  const globals = await page.evaluate(() => {
    const scope = globalThis as RendererGlobals;
    return {
      hasPb: typeof scope.pb?.library.query === 'function',
      hasRequire: typeof scope.require !== 'undefined',
    };
  });
  expect(globals).toEqual({ hasPb: true, hasRequire: false });
  const session = await page.evaluate(() => (globalThis as RendererGlobals).pb!.session.current());
  expect(session.role).toBe('admin');
});

test('navigates between screens from the sidebar', async () => {
  const page = await app.firstWindow();
  await page.getByRole('link', { name: 'Plugins' }).click();
  await expect(page.getByRole('heading', { name: 'Plugins' })).toBeVisible();
});
