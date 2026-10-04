import type { SyncBatch } from '@photobeaver/plugin-sdk';
import type { FakeContextOptions } from '@photobeaver/plugin-sdk/testing';
import { FakeDropbox } from './fake-dropbox';

export const SAMPLE_FILES = [
  '/Photos/2024/beach.jpg',
  '/Photos/2024/clip.mov',
  '/Photos/2024/notes.txt',
  '/Photos/2025/snow.HEIC',
  '/Photos/2025/raw/dsc_001.nef',
  '/Camera Uploads/IMG_0001.png',
  '/Camera Uploads/IMG_0002.mp4',
  '/Documents/report.pdf',
  '/top.webp',
];

/**
 * A fake Dropbox seeded with a mix of media and non-media files.
 *
 * @param files - Paths to create.
 * @returns The fake.
 */
export function seededDropbox(files: string[] = SAMPLE_FILES): FakeDropbox {
  const fake = new FakeDropbox();
  for (const file of files) fake.addFile(file);
  return fake;
}

/**
 * Fake host options that point the connector at a fake Dropbox.
 *
 * @param fake - The fake API.
 * @param overrides - Extra options.
 * @returns Context options for the SDK fakes.
 */
export function contextFor(
  fake: FakeDropbox,
  overrides: Omit<FakeContextOptions, 'known'> = {},
): Omit<FakeContextOptions, 'known'> {
  return {
    fetch: fake.fetch,
    secret: { ...fake.tokens() },
    settings: { clientId: 'k' },
    oauth: { refresh: fake.refresh },
    ...overrides,
  };
}

/**
 * Collects every batch from a sync.
 *
 * @param batches - The sync iterator.
 * @returns All batches.
 */
export async function collect(batches: AsyncIterable<SyncBatch>): Promise<SyncBatch[]> {
  const result: SyncBatch[] = [];
  for await (const batch of batches) result.push(batch);
  return result;
}
