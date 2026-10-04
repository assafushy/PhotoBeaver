import { describe, it } from 'vitest';
import { connectorContract } from '@photobeaver/plugin-sdk/testing';
import connector from '../src';
import { FakeGraph, graphContext, seedLibrary } from './fake-graph';

const graph = new FakeGraph();
const media = seedLibrary(graph);

async function removeOne(): Promise<string> {
  graph.remove(media[0]!);
  return media[0]!;
}

describe('connector-onedrive contract', () => {
  const fixture = { config: { folder: '' }, removeOne, context: graphContext(graph) };
  for (const check of connectorContract(connector, fixture)) it(check.name, check.run);
});
