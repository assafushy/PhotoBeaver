import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { connectorContract } from '@photobeaver/plugin-sdk/testing';
import connector, { BATCH_SIZE, type InstagramExportConfig } from '../src';
import { simpleExport, tempDir, writeFiles } from './fixture';

const uris = Array.from(
  { length: BATCH_SIZE + 5 },
  (_, i) => `media/posts/${202401 + (i % 3)}/p${String(i).padStart(4, '0')}.jpg`,
);
const dir = tempDir();
writeFiles(dir.root, simpleExport(uris));
const config: InstagramExportConfig = { root: dir.root };

async function removeOne(): Promise<string> {
  const removed = [...uris].sort()[0]!;
  rmSync(path.join(dir.root, removed));
  return removed;
}

describe('connector-instagram-export contract', () => {
  afterAll(() => dir.cleanup());
  for (const check of connectorContract(connector, { config, removeOne }))
    it(check.name, check.run);
});
