import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loadVectorExtension } from '@photobeaver/db';
import Database from 'better-sqlite3';
import { writeImageSet } from '../fixtures/generate';
import { launchApp, libraryCount, removeDir, tempDir, type RendererGlobals } from './app';

test.describe.configure({ mode: 'serial' });

let root: string;
let userData: string;

function embedding(group: number, index: number): Float32Array {
  const v = new Float32Array(512);
  v[group] = 1;
  v[100 + (index % 5)] = 0.1;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

function seedFaces(dir: string): void {
  const db = new Database(path.join(dir, 'library', 'photobeaver.db'));
  loadVectorExtension(db);
  const assets = db.prepare('SELECT id FROM assets ORDER BY id').all() as { id: string }[];
  const face = db.prepare(
    "INSERT INTO faces (id, asset_id, plugin_id, bbox_json, confidence, assigned_by) VALUES (?, ?, 'test', ?, 0.9, 'auto')",
  );
  const vector = db.prepare('INSERT INTO faces_vec (face_id, embedding) VALUES (?, ?)');
  assets.forEach(({ id }, index) => {
    const faceId = `F${String(index).padStart(25, '0')}`;
    face.run(faceId, id, JSON.stringify({ x: 0.3, y: 0.2, w: 0.3, h: 0.4 }));
    vector.run(faceId, embedding((index % 2) + 1, index));
  });
  db.close();
}

async function waitForPeople(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (globalThis as RendererGlobals).pb.people.list())).length,
      { timeout: 30_000 },
    )
    .toBe(count);
}

test.beforeAll(async () => {
  root = tempDir('pb-e2e-people-');
  userData = tempDir('pb-e2e-people-data-');
  await writeImageSet(root, 6);
  const { app, page } = await launchApp(userData);
  await page.evaluate(
    (r) =>
      (globalThis as RendererGlobals).pb.sources.add({
        pluginId: 'com.photobeaver.connector-local',
        config: { root: r },
      }),
    root,
  );
  await expect.poll(() => libraryCount(page), { timeout: 30_000 }).toBe(6);
  await app.close();
  seedFaces(userData);
});

test.afterAll(() => [root, userData].forEach(removeDir));

test('groups faces into people that can be named and searched', async () => {
  const { app, page } = await launchApp(userData);
  await waitForPeople(page, 2);
  await page.evaluate(
    (id) => (globalThis as RendererGlobals).pb.plugins.list().then(() => id),
    'x',
  );
  await page.goto(page.url().replace(/#.*$/, '#/people'));
  const cards = page.getByTestId('person-card');
  await expect(cards).toHaveCount(2);
  await cards.first().getByTestId('person-name').click();
  await page.getByTestId('person-name-input').fill('Ada Lovelace');
  await page.getByTestId('person-name-input').press('Enter');
  await expect(cards.first()).toContainText('Ada Lovelace');
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId('search-box').fill('Lovelace');
  await expect.poll(() => libraryCount(page), { timeout: 10_000 }).toBe(3);
  await page.getByTestId('library-tile').first().click();
  await expect(page.getByTestId('viewer-person')).toContainText('Ada Lovelace');
  await app.close();
});

test('splits a face off into a new person', async () => {
  const { app, page } = await launchApp(userData);
  await waitForPeople(page, 2);
  await page.goto(page.url().replace(/#.*$/, '#/people'));
  await page.getByTestId('person-card').first().locator('a').click();
  await expect(page.getByTestId('person-page')).toBeVisible();
  await page.getByTestId('person-face').first().click();
  await page.getByRole('button', { name: 'Move to a new person' }).click();
  await waitForPeople(page, 3);
  await app.close();
});
