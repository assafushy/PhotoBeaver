import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSync } from '@photobeaver/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';
import connector, { PAGE_SIZE } from '../src';
import { FakePicker, pickedItem } from './fake-picker';

const items = Array.from({ length: PAGE_SIZE * 2 + 7 }, (_, i) => pickedItem(i));

function pickOnce() {
  const fake = new FakePicker(items);
  const context = {
    fetch: fake.fetch,
    settings: { clientId: 'c', clientSecret: 's' },
    secret: { accessToken: fake.validToken },
    dataDir: mkdtempSync(path.join(tmpdir(), 'pb-gphotos-contract-')),
  };
  return runSync(connector, { config: { mode: 'picker' }, context });
}

describe(
  'connector-google-photos Picker contract (the checks that apply)',
  { timeout: 30_000 },
  () => {
    it('every batch has a string cursor', async () => {
      const { batches } = await pickOnce();
      expect(batches.length).toBeGreaterThan(0);
      for (const batch of batches) expect(typeof batch.cursor).toBe('string');
    });

    it(`no batch has more than ${PAGE_SIZE} upserts`, async () => {
      const { batches } = await pickOnce();
      for (const batch of batches)
        expect(batch.upserts?.length ?? 0).toBeLessThanOrEqual(PAGE_SIZE);
    });

    it('never marks a full scan or deletes', async () => {
      const { batches } = await pickOnce();
      expect(batches.filter((batch) => batch.isFullScan || batch.deletes?.length)).toEqual([]);
    });

    it('externalIds are unique and stable across picks of the same items', async () => {
      const first = (await pickOnce()).items.map((item) => item.externalId);
      const second = (await pickOnce()).items.map((item) => item.externalId);
      expect(new Set(first).size).toBe(items.length);
      expect(second).toEqual(first);
    });
  },
);
