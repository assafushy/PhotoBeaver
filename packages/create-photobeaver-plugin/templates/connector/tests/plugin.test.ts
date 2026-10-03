import { describe, expect, it } from 'vitest';
import { connectorContract, runSync } from '@photobeaver/plugin-sdk/testing';
import connector, { sampleItems, type Config } from '../src/index';

describe('{{name}}', () => {
  it('syncs the sample items', async () => {
    const result = await runSync(connector, { config: {} });
    expect(result.items.map((item) => item.externalId)).toEqual(['sample-1', 'sample-2']);
    expect(result.batches.at(-1)?.isFullScan).toBe(true);
  });

  it('streams original bytes', async () => {
    const stream = await connector.getOriginal({} as never, {
      sourceId: 'test',
      externalId: 'sample-1',
    });
    expect(await new Response(stream).text()).toBe('Sample bytes for sample-1');
  });
});

describe('connector contract', () => {
  const config: Config = { items: [...sampleItems] };
  const fixture = { config, removeOne: async () => config.items!.pop()!.externalId };
  for (const check of connectorContract(connector, fixture)) it(check.name, check.run);
});
