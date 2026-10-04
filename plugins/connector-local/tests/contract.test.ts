import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, it } from 'vitest';
import { connectorContract } from '@photobeaver/plugin-sdk/testing';
import connector, { BATCH_SIZE, type LocalConfig } from '../src';
import { makeTree } from './helpers';

const FILE_COUNT = BATCH_SIZE + 5;
const files = Array.from(
  { length: FILE_COUNT },
  (_, i) => `d${i % 3}/p${String(i).padStart(4, '0')}.jpg`,
);
const tree = makeTree([...files, 'notes.txt']);
const config: LocalConfig = { root: tree.root };

async function removeOne(): Promise<string> {
  const removed = path.join(tree.root, ...files[0]!.split('/'));
  rmSync(removed);
  return removed;
}

describe('connector-local contract', () => {
  afterAll(() => tree.cleanup());
  for (const check of connectorContract(connector, { config, removeOne }))
    it(check.name, check.run);
});
