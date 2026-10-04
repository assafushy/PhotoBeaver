import { describe, it } from 'vitest';
import { connectorContract } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { FakeDropbox } from './fake-dropbox';

const fake = new FakeDropbox();
const files = Array.from({ length: 20 }, (_, i) => fake.addFile(`/Photos/d${i % 3}/p${i}.jpg`));
fake.addFile('/Photos/readme.txt');

async function removeOne(): Promise<string> {
  fake.removePath(files[0]!.path);
  return files[0]!.id;
}

describe('connector-dropbox contract', () => {
  const context = { fetch: fake.fetch, secret: { ...fake.tokens() }, settings: { clientId: 'k' } };
  for (const check of connectorContract(connector, { config: {}, removeOne, context }))
    it(check.name, check.run);
});
