import { rmSync } from 'node:fs';
import path from 'node:path';
import { connectorContract } from '@photobeaver/plugin-sdk/testing';
import { afterAll, describe, it } from 'vitest';
import connector, { BATCH_SIZE, type GooglePhotosConfig } from '../src';
import { PHOTOS, sidecar, tempDir, writeFiles } from './helpers';

const dir = tempDir();
const files: Record<string, string> = {};
const photos = Array.from({ length: BATCH_SIZE + 10 }, (_, i) => {
  const name = `${PHOTOS}/Photos from ${2000 + (i % 3)}/p${String(i).padStart(4, '0')}.jpg`;
  files[name] = `photo ${i}`;
  files[`${name}.supplemental-metadata.json`] = sidecar({ timestamp: 1_600_000_000 + i });
  return name;
});
for (const name of photos.slice(-5)) {
  files[name.replace(/Photos from \d+/, 'Album')] = files[name]!;
}
files[`${PHOTOS}/Album/extra.jpg`] = 'extra';
writeFiles(dir.root, files);

const config: GooglePhotosConfig = { mode: 'takeout', root: dir.root };

async function removeOne(): Promise<string> {
  rmSync(path.join(dir.root, ...photos[0]!.split('/')));
  return photos[0]!;
}

describe('connector-google-photos Takeout contract', () => {
  afterAll(() => dir.cleanup());
  for (const check of connectorContract(connector, { config, removeOne }))
    it(check.name, check.run, 30_000);
});
